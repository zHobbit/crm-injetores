import { endOfDay } from 'date-fns'
import { msDay } from './format'
import type { Action, AutomationRule, Condition, CrmData, Deal } from './types'

// Motor de automação declarativo — PURO: avalia regras e devolve ações; quem executa
// (applyFiredActions + EngineApi) e quem grava lastFiredAt (markFired) é o chamador (Task 6).
//
// Campos declarativos ainda não executados: `delay` (tudo roda síncrono), `workWindow`
// e `canInterrupt` — ficam no schema para quando houver fila/agenda.

export interface EngineEvent {
  kind: 'deal_created' | 'stage_changed' | 'field_changed' | 'tag_changed'
  dealId: string
  at: number
  /** stage_changed: id OU nome da etapa anterior/nova; tag_changed: tag (newValue = adicionada, oldValue = removida) */
  oldValue?: string
  newValue?: string
  fieldCode?: string // field_changed
}

export interface EngineCtx {
  data: CrmData
  lastContactMs: (dealId: string) => number
  now: number
}

export interface FiredAction {
  ruleId: string
  dealId: string
  action: Action
}

export interface EngineApi {
  createTask(input: { dealId: string | null; text: string; kind: string; dueAt: number | null }): unknown
  moveDeal(id: string, toStageId: string): void
  setField(id: string, code: string, value: string | number): void
  addTag(id: string, tag: string): void
  removeTag(id: string, tag: string): void
  addNote(id: string, text: string): void
  createDealFromTemplate(template: 'posvenda' | 'garantia', atStageId: string, sourceDealId: string): void
}

const str = (v: unknown): string => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v))

export function matchesCondition(c: Condition, deal: Deal, ctx: EngineCtx): boolean {
  switch (c.field) {
    case 'stage':
      return c.value.includes(deal.stageId)
    case 'source':
      return deal.sourceId !== null && c.value.includes(deal.sourceId)
    case 'profile': {
      const contact = deal.contactId ? ctx.data.contacts[deal.contactId] : undefined
      const is = str(contact?.custom['profile']) === c.value
      return c.op === 'is' ? is : !is
    }
    case 'price':
      if (c.op === 'between') return deal.priceCents >= c.value[0] && deal.priceCents <= c.value[1]
      return c.op === 'gt' ? deal.priceCents > c.value : deal.priceCents < c.value
    case 'custom': {
      const v = str(deal.custom[c.fieldCode])
      switch (c.op) {
        case 'filled':
          return v !== ''
        case 'not_filled':
          return v === ''
        case 'eq':
          return v === (c.value ?? '')
        case 'contains':
          return v.toLowerCase().includes((c.value ?? '').toLowerCase())
      }
      return false
    }
    case 'has_tag': {
      const has = deal.tags.includes(c.value)
      return c.op === 'has' ? has : !has
    }
  }
}

const conditionsHold = (rule: AutomationRule, deal: Deal, ctx: EngineCtx) => {
  const { logic, items } = rule.conditions
  if (items.length === 0) return true
  return logic === 'or'
    ? items.some((c) => matchesCondition(c, deal, ctx))
    : items.every((c) => matchesCondition(c, deal, ctx))
}

const pipelineOk = (rule: AutomationRule, deal: Deal) =>
  rule.dealPipelineId === 'any' || rule.dealPipelineId === deal.pipelineId

const cooldownOk = (rule: AutomationRule, dealId: string, now: number) => {
  const last = rule.lastFiredAt?.[dealId]
  return !rule.cooldown || last === undefined || now - last >= rule.cooldown * 1000
}

/** Aceita id ou nome da etapa (o feed de atividades registra nomes). Prefere o pipeline do deal. */
const resolveStageId = (data: CrmData, deal: Deal, idOrName: string | undefined): string | undefined => {
  if (!idOrName) return undefined
  if (data.stages[idOrName]) return idOrName
  const named = Object.values(data.stages).filter((s) => s.name === idOrName)
  return (named.find((s) => s.pipelineId === deal.pipelineId) ?? named[0])?.id
}

const triggerMatches = (rule: AutomationRule, event: EngineEvent, deal: Deal, data: CrmData): boolean => {
  const t = rule.trigger
  if (t.kind !== event.kind) return false
  switch (t.kind) {
    case 'deal_created':
      return true
    case 'stage_changed':
      return t.toStageId === undefined || resolveStageId(data, deal, event.newValue) === t.toStageId
    case 'tag_changed': {
      const tag = event.newValue || event.oldValue
      return t.action === (event.newValue ? 'added' : 'removed') && (t.tag === undefined || t.tag === tag)
    }
    case 'field_changed':
      return event.fieldCode === t.fieldCode
    default:
      return false // days_no_contact / task_overdue só no tick
  }
}

const expand = (rule: AutomationRule, dealId: string): FiredAction[] =>
  rule.actions.map((action) => ({ ruleId: rule.id, dealId, action }))

/** Regras disparadas por um evento de negócio, na ordem das regras e das ações. Síncrono e puro. */
export function evaluateRules(ctx: EngineCtx, event: EngineEvent): FiredAction[] {
  const deal = ctx.data.deals[event.dealId]
  if (!deal) return []
  return ctx.data.automations.flatMap((rule) =>
    rule.enabled &&
    pipelineOk(rule, deal) &&
    triggerMatches(rule, event, deal, ctx.data) &&
    cooldownOk(rule, deal.id, ctx.now) &&
    conditionsHold(rule, deal, ctx)
      ? expand(rule, deal.id)
      : [],
  )
}

/**
 * Regras de tempo (rodar periodicamente). Sem `cooldown`, cada regra dispara UMA vez por
 * "episódio" para não duplicar tarefas a cada tick:
 *   - days_no_contact: uma vez por período sem contato (rearma quando há contato novo)
 *   - task_overdue: uma vez para cada tarefa que entra em atraso
 * Com `cooldown`, repete a cada janela enquanto a condição persistir (ex.: lembrete diário).
 */
export function evaluateTick(ctx: EngineCtx): FiredAction[] {
  const { data, now } = ctx
  const timeRules = data.automations.filter(
    (r) => r.enabled && (r.trigger.kind === 'days_no_contact' || r.trigger.kind === 'task_overdue'),
  )
  if (timeRules.length === 0) return []

  // vencimento mais recente entre as tarefas abertas atrasadas, por deal
  const latestOverdue = new Map<string, number>()
  for (const t of Object.values(data.tasks)) {
    if (!t.dealId || t.completed || t.dueAt === null || t.dueAt >= now) continue
    latestOverdue.set(t.dealId, Math.max(latestOverdue.get(t.dealId) ?? -Infinity, t.dueAt))
  }

  const fired: FiredAction[] = []
  for (const deal of Object.values(data.deals)) {
    for (const rule of timeRules) {
      if (!pipelineOk(rule, deal) || !cooldownOk(rule, deal.id, now)) continue
      const last = rule.lastFiredAt?.[deal.id]
      let due = false
      if (rule.trigger.kind === 'days_no_contact') {
        const lastContact = ctx.lastContactMs(deal.id)
        due = (now - lastContact) / msDay >= rule.trigger.days
        if (due && !rule.cooldown && last !== undefined && last >= lastContact) due = false
      } else {
        const overdueAt = latestOverdue.get(deal.id)
        due = overdueAt !== undefined && (last === undefined || last < overdueAt)
      }
      if (due && conditionsHold(rule, deal, ctx)) fired.push(...expand(rule, deal.id))
    }
  }
  return fired
}

/** Novo array de regras com lastFiredAt[dealId] = now para cada (regra, deal) disparado. Puro. */
export function markFired(rules: AutomationRule[], fired: FiredAction[], now: number): AutomationRule[] {
  const byRule = new Map<string, Set<string>>()
  for (const f of fired) {
    if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, new Set())
    byRule.get(f.ruleId)!.add(f.dealId)
  }
  return rules.map((r) => {
    const deals = byRule.get(r.id)
    if (!deals) return r
    const lastFiredAt = { ...r.lastFiredAt }
    for (const d of deals) lastFiredAt[d] = now
    return { ...r, lastFiredAt }
  })
}

/**
 * Executa as ações na ordem, via API do store. `open_whatsapp` vira tarefa + nota (não abre janela).
 * Prazo de tarefa = fim do dia (local) de hoje + inDays: "para hoje" não nasce atrasada.
 */
export function applyFiredActions(fired: FiredAction[], api: EngineApi, now = Date.now()): void {
  const dueIn = (days: number) => endOfDay(now + days * msDay).getTime()
  for (const { dealId, action: a } of fired) {
    switch (a.kind) {
      case 'create_task':
        api.createTask({ dealId, text: a.text, kind: a.kindTag, dueAt: dueIn(a.inDays) })
        break
      case 'change_stage':
        api.moveDeal(dealId, a.toStageId)
        break
      case 'set_field':
        api.setField(dealId, a.fieldCode, a.value)
        break
      case 'add_tag':
        api.addTag(dealId, a.tag)
        break
      case 'remove_tag':
        api.removeTag(dealId, a.tag)
        break
      case 'add_note':
        api.addNote(dealId, a.text)
        break
      case 'open_whatsapp': {
        const text = `Follow-up WhatsApp: ${a.template}`
        api.createTask({ dealId, text, kind: 'acompanhar', dueAt: dueIn(0) })
        api.addNote(dealId, text)
        break
      }
      case 'create_deal':
        api.createDealFromTemplate(a.template, a.atStageId, dealId)
        break
    }
  }
}
