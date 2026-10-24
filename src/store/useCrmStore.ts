import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Activity,
  ActivityType,
  AutomationRule,
  Contact,
  CrmData,
  CustomField,
  Deal,
  FieldDiffParam,
  FieldKind,
  Pipeline,
  Stage,
  Task,
} from '../domain/types'
import { fmtBRL, normalizePhone } from '../domain/format'
import { coerceV1Deals, dealsV1ToCrmDataV2 } from '../domain/migration'
import { mergeWithSeed, sanitizeCrmData } from '../domain/sanitize'
import {
  activityIndex,
  extendActivityIndex,
  rememberActivityIndex,
  resetDealInIndex,
} from '../domain/indexes'
import { bindFlushOnExit, createThrottledJSONStorage } from '../lib/throttledStorage'
import { seedCrmData, upgradeSeedAutomations } from './seed'
import {
  applyFiredActions,
  evaluateRules,
  evaluateTick,
  markFired,
  type EngineApi,
  type EngineCtx,
  type EngineEvent,
  type FiredAction,
} from '../domain/automationEngine'

type FieldValue = string | number | string[] | null

export interface DealInput2 {
  name: string
  phone: string
  contactId?: string | null
  pipelineId: string
  stageId: string
  priceCents: number
  custom: Record<string, FieldValue>
  contactCustom?: Record<string, FieldValue>
  notes?: string
  sourceId?: string | null
}

interface CrmState {
  data: CrmData
  addDeal: (input: DealInput2) => string
  updateDeal: (id: string, patch: Partial<DealInput2>) => void
  removeDeal: (id: string) => void
  moveDeal: (id: string, toStageId: string, overId?: string) => void
  logContactToday: (id: string) => void
  addNote: (id: string, text: string) => void
  setField: (id: string, code: string, value: FieldValue) => void
  addTag: (id: string, tag: string) => void
  removeTag: (id: string, tag: string) => void
  createTask: (input: { dealId: string | null; text: string; kind: string; dueAt: number | null }) => string
  completeTask: (taskId: string, result?: string) => void
  setLoss: (id: string, lossReasonId: string) => void
  importDeals: (items: { customerName: string; phone: string }[]) => number
  replaceAll: (data: CrmData) => void
  resetSeed: () => void
  upsertStage: (stage: Stage) => void
  removeStage: (id: string) => void
  upsertCustomField: (field: CustomField) => void
  upsertAutomation: (rule: AutomationRule) => void
  /** Ação de automação `create_deal`: novo negócio derivado (pós-venda/garantia) do mesmo contato. */
  createDealFromTemplate: (template: 'posvenda' | 'garantia', atStageId: string, sourceDealId: string) => string | null
}

export const PERSIST_KEY = 'crm.deals.v1' // NÃO renomear: descartaria os dados salvos
export const BACKUP_KEY = 'crm.deals.v1.backup'
const PERSIST_WRITE_MS = 500 // janela do agrupamento de gravações (risco máx. em crash)
const ACTIVITY_CAP_PER_DEAL = 500

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`

// ---------- helpers puros ----------
const str = (v: FieldValue | undefined): string =>
  v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)

const sameValue = (a: FieldValue | undefined, b: FieldValue | undefined) => str(a) === str(b)

const kindOfCode = (data: CrmData, code: string): FieldKind =>
  Object.values(data.customFields).find((f) => f.code === code)?.kind ?? 'text'

const param = (fieldId: string, kind: FieldKind, oldValue: string, newValue: string): FieldDiffParam => ({
  fieldId,
  kind,
  oldValue,
  newValue,
})

const makeActivity = (
  dealId: string,
  type: ActivityType,
  text: string,
  params: FieldDiffParam[] = [],
  createdAt = Date.now(),
): Activity => ({ id: `act-${uid()}`, dealId, type, text, params, authorName: 'me', createdAt })

/**
 * Insere atividades respeitando o teto por deal (descarta as mais antigas, nunca deal_created).
 * O índice (contagem + último contato) é derivado do anterior sem varrer a coleção; só um
 * deal que estoura o teto paga a varredura das próprias atividades para escolher o que cortar.
 */
const withActivities = (data: CrmData, acts: Activity[]): CrmData => {
  if (acts.length === 0) return data
  const activities = { ...data.activities }
  for (const a of acts) activities[a.id] = a
  const idx = extendActivityIndex(activityIndex(data.activities), acts)
  for (const dealId of new Set(acts.map((a) => a.dealId))) {
    if ((idx.count.get(dealId) ?? 0) <= ACTIVITY_CAP_PER_DEAL) continue
    const own = Object.values(activities).filter((a) => a.dealId === dealId)
    const removable = own.filter((a) => a.type !== 'deal_created').sort((a, b) => a.createdAt - b.createdAt)
    for (const a of removable.slice(0, own.length - ACTIVITY_CAP_PER_DEAL)) delete activities[a.id]
    resetDealInIndex(idx, dealId, own.filter((a) => a.id in activities))
  }
  rememberActivityIndex(activities, idx)
  return { ...data, activities }
}

const stageName = (data: CrmData, id: string) => data.stages[id]?.name ?? id

/** Ordem da coluna: ids da etapa ordenados por `order`. */
const columnIds = (deals: Record<string, Deal>, stageId: string, exclude?: string) =>
  Object.values(deals)
    .filter((d) => d.stageId === stageId && d.id !== exclude)
    .sort((a, b) => a.order - b.order)
    .map((d) => d.id)

const renumber = (deals: Record<string, Deal>, ids: string[]) => {
  ids.forEach((id, i) => {
    if (deals[id].order !== i) deals[id] = { ...deals[id], order: i }
  })
}

/** Etapas de pré-venda: abertas e anteriores à primeira etapa `won` do pipeline. */
export function preSaleStageIds(data: CrmData, pipelineId = data.settings.defaultPipelineId): Set<string> {
  const stages = Object.values(data.stages).filter((s) => s.pipelineId === pipelineId)
  const wonSort = Math.min(...stages.filter((s) => s.kind === 'won').map((s) => s.sort))
  return new Set(stages.filter((s) => s.kind === 'open' && s.sort < wonSort).map((s) => s.id))
}

const isClosedStage = (data: CrmData, stageId: string) => {
  const kind = data.stages[stageId]?.kind
  return kind === 'won' || kind === 'lost'
}

const withoutContact = (contacts: Record<string, Contact>, id: string) => {
  const next = { ...contacts }
  delete next[id]
  return next
}

export function pipelineStages(data: CrmData, pipelineId = data.settings.defaultPipelineId): Stage[] {
  return Object.values(data.stages)
    .filter((s) => s.pipelineId === pipelineId)
    .sort((a, b) => a.sort - b.sort)
}

/**
 * `createdAt` da última Activity contact_logged do deal (fallback: deal.createdAt).
 * O(1) amortizado: lê o índice derivado (domain/indexes), construído uma vez por versão
 * da coleção de atividades — chamar para todos os cards/filtros não varre N×A.
 */
export function lastContactMsOf(data: CrmData, dealId: string): number {
  return activityIndex(data.activities).lastContact.get(dealId) ?? data.deals[dealId]?.createdAt ?? 0
}

export interface DealView {
  deal: Deal
  contact: Contact | null
  stage: Stage | null
  pipeline: Pipeline | null
  lastContactMs: number
  openTasks: Task[]
}

export function buildDealView(data: CrmData, id: string): DealView | null {
  const deal = data.deals[id]
  if (!deal) return null
  return {
    deal,
    contact: deal.contactId ? (data.contacts[deal.contactId] ?? null) : null,
    stage: data.stages[deal.stageId] ?? null,
    pipeline: data.pipelines[deal.pipelineId] ?? null,
    lastContactMs: lastContactMsOf(data, id),
    openTasks: Object.values(data.tasks)
      .filter((t) => t.dealId === id && !t.completed)
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)),
  }
}

/** Mescla dados persistidos/restaurados com o seed e saneia (reparando) o resultado. */
const withSeedDefaults = (data: Partial<CrmData>): CrmData => {
  const clean = sanitizeCrmData(mergeWithSeed(data, seedCrmData()))
  return { ...clean, automations: upgradeSeedAutomations(clean.automations) }
}

/**
 * `migrate` do persist (exportado p/ teste). v1 (`{ deals: DealV1[] }`) →
 * grava backup uma única vez e converte; v2 passa adiante com defaults do seed.
 */
export const persistMigrate = (persisted: unknown, version: number): Pick<CrmState, 'data'> => {
  const p = persisted as { deals?: unknown; data?: Partial<CrmData> } | null
  if (version < 2 && p) {
    // backup de QUALQUER payload pré-v2, inclusive formato inesperado que cairá no seed
    try {
      if (localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, JSON.stringify(persisted))
    } catch {
      // sem storage (SSR/teste) ou cota cheia: migra mesmo assim
    }
  }
  if (version < 2 && p && Array.isArray(p.deals)) {
    return { data: dealsV1ToCrmDataV2(coerceV1Deals(p.deals as unknown[]), Date.now()) }
  }
  if (p?.data && p.data.version === 2) return { data: withSeedDefaults(p.data) }
  return { data: seedCrmData() }
}

/**
 * `merge` do persist: roda em TODA hidratação (o `migrate` só roda quando a versão
 * salva difere), então é aqui que o estado v2 já persistido passa pelo saneamento.
 */
export const persistMerge = <S extends Pick<CrmState, 'data'>>(persisted: unknown, current: S): S => {
  const p = persisted as { data?: Partial<CrmData> } | null
  return p?.data && p.data.version === 2 ? { ...current, data: withSeedDefaults(p.data) } : current
}

// ---------- store ----------
/** Storage do persist com gravação agrupada (ver lib/throttledStorage). Exportado p/ flush em teste. */
export const crmStorage = createThrottledJSONStorage<Pick<CrmState, 'data'>>(() => localStorage, PERSIST_WRITE_MS)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  bindFlushOnExit(crmStorage.flush, window, document)
}

export const useCrmStore = create<CrmState>()(
  persist(
    (set, get) => {
      /** Aplica `fn` ao deal, carimba updatedAt/updatedBy e registra as atividades devolvidas. */
      const mutate = (id: string, fn: (deal: Deal, data: CrmData) => { deal: Deal; acts: Activity[] } | null) =>
        set((s) => {
          const deal = s.data.deals[id]
          if (!deal) return s
          const res = fn(deal, s.data)
          if (!res) return s
          const next = { ...res.deal, updatedAt: Date.now(), updatedBy: 'me' }
          return { data: withActivities({ ...s.data, deals: { ...s.data.deals, [id]: next } }, res.acts) }
        })

      const base: CrmState = {
        data: seedCrmData(),

        addDeal: (input) => {
          const id = uid()
          const now = Date.now()
          set((s) => {
            const phone = normalizePhone(input.phone)
            const contacts = { ...s.data.contacts }
            let contactId =
              input.contactId ??
              (phone ? Object.values(contacts).find((c) => c.phone === phone)?.id : undefined) ??
              null
            if (contactId && contacts[contactId]) {
              // contato já existe (pessoa compartilhada): só preenche chaves vazias, nunca sobrescreve
              const c = contacts[contactId]
              const missing = Object.entries(input.contactCustom ?? {}).filter(([k]) => str(c.custom[k]) === '')
              if (missing.length > 0) {
                contacts[contactId] = { ...c, custom: { ...c.custom, ...Object.fromEntries(missing) }, updatedAt: now }
              }
            } else {
              contactId = `c-${uid()}`
              contacts[contactId] = {
                id: contactId,
                name: input.name,
                phone,
                createdAt: now,
                updatedAt: now,
                custom: { ...input.contactCustom },
              }
            }
            const deal: Deal = {
              id,
              pipelineId: s.data.stages[input.stageId]?.pipelineId ?? input.pipelineId, // etapa define o pipeline
              stageId: input.stageId,
              unsorted: false,
              name: input.name,
              contactId,
              companyId: null,
              order: columnIds(s.data.deals, input.stageId).length,
              priceCents: input.priceCents,
              sourceId: input.sourceId ?? null,
              lossReasonId: null,
              currency: 'BRL',
              closedAt: isClosedStage(s.data, input.stageId) ? now : null,
              custom: input.notes !== undefined ? { ...input.custom, notes: input.notes } : { ...input.custom },
              tags: [],
              createdAt: now,
              updatedAt: now,
              createdBy: 'me',
              updatedBy: 'me',
            }
            const act = makeActivity(
              id,
              'deal_created',
              'Negociação criada',
              [param('name', 'text', '', input.name), param('phone', 'text', '', phone)],
              now,
            )
            return { data: withActivities({ ...s.data, contacts, deals: { ...s.data.deals, [id]: deal } }, [act]) }
          })
          return id
        },

        updateDeal: (id, patch) =>
          set((s) => {
            const deal = s.data.deals[id]
            if (!deal) return s
            const params: FieldDiffParam[] = []
            const next: Deal = { ...deal, custom: { ...deal.custom } }

            if (patch.name !== undefined && patch.name !== deal.name) {
              params.push(param('name', 'text', deal.name, patch.name))
              next.name = patch.name
            }
            if (patch.priceCents !== undefined && patch.priceCents !== deal.priceCents) {
              params.push(param('price', 'money', fmtBRL(deal.priceCents), fmtBRL(patch.priceCents)))
              next.priceCents = patch.priceCents
            }
            if (patch.sourceId !== undefined && patch.sourceId !== deal.sourceId) {
              const name = (sid: string | null) => (sid ? (s.data.sources[sid]?.name ?? sid) : '')
              params.push(param('source', 'select', name(deal.sourceId), name(patch.sourceId)))
              next.sourceId = patch.sourceId
            }
            const custom = { ...patch.custom }
            if (patch.notes !== undefined) custom.notes = patch.notes
            for (const [code, value] of Object.entries(custom)) {
              if (sameValue(deal.custom[code], value)) continue
              params.push(param(code, kindOfCode(s.data, code), str(deal.custom[code]), str(value)))
              next.custom[code] = value
            }

            let contacts = s.data.contacts
            let contact = deal.contactId ? contacts[deal.contactId] : undefined
            const newPhone = patch.phone !== undefined ? normalizePhone(patch.phone) : ''
            if (!contact && (newPhone || Object.keys(patch.contactCustom ?? {}).length > 0)) {
              // deal sem contato (ex.: contactId zerado no saneamento): telefone/perfil digitados não podem sumir
              const phone = newPhone
              const now = Date.now()
              const target: Contact = (phone ? Object.values(contacts).find((c) => c.phone === phone) : undefined) ?? {
                id: `c-${uid()}`,
                name: deal.name,
                phone,
                createdAt: now,
                updatedAt: now,
                custom: {},
              }
              if (phone) params.push(param('phone', 'text', '', phone))
              contacts = { ...contacts, [target.id]: target }
              next.contactId = target.id
              contact = target
            }
            if (contact && patch.phone !== undefined) {
              const phone = normalizePhone(patch.phone)
              const shared = Object.values(s.data.deals).some((d) => d.id !== id && d.contactId === contact!.id)
              const existing = phone
                ? Object.values(contacts).find((c) => c.phone === phone && c.id !== contact!.id)
                : undefined
              if (phone !== contact.phone && (shared || existing)) {
                // telefone identifica a pessoa: com contato compartilhado, desvincula só este deal
                // (religando a um contato existente com o novo telefone, ou criando um próprio)
                params.push(param('phone', 'text', contact.phone, phone))
                const now = Date.now()
                const target: Contact = existing ?? {
                  ...contact,
                  id: `c-${uid()}`,
                  name: deal.name,
                  phone,
                  custom: { ...contact.custom },
                  createdAt: now,
                  updatedAt: now,
                }
                contacts = { ...contacts, [target.id]: target }
                if (!shared) contacts = withoutContact(contacts, contact.id)
                next.contactId = target.id
                contact = target
              }
            }
            if (contact) {
              const c: Contact = { ...contact, custom: { ...contact.custom } }
              let changed = false
              if (patch.phone !== undefined) {
                const phone = normalizePhone(patch.phone)
                if (phone !== contact.phone) {
                  params.push(param('phone', 'text', contact.phone, phone))
                  c.phone = phone
                  changed = true
                }
              }
              if (patch.name !== undefined && patch.name !== contact.name && contact.name === deal.name) {
                c.name = patch.name // contato acompanha o nome enquanto espelhar o deal
                changed = true
              }
              // contrato: patch.contactCustom traz só o que o usuário alterou (o drawer manda
              // apenas campos sujos), então ao religar a outro contato nada herdado vaza
              for (const [code, value] of Object.entries(patch.contactCustom ?? {})) {
                if (sameValue(contact.custom[code], value)) continue
                params.push(param(code, kindOfCode(s.data, code), str(contact.custom[code]), str(value)))
                c.custom[code] = value
                changed = true
              }
              if (changed) contacts = { ...contacts, [c.id]: { ...c, updatedAt: Date.now() } }
            }

            if (params.length === 0) return s
            next.updatedAt = Date.now()
            next.updatedBy = 'me'
            const act = makeActivity(id, 'field_changed', 'Campos alterados', params)
            return { data: withActivities({ ...s.data, contacts, deals: { ...s.data.deals, [id]: next } }, [act]) }
          }),

        removeDeal: (id) =>
          set((s) => {
            if (!s.data.deals[id]) return s
            const deals = { ...s.data.deals }
            const { stageId, contactId } = deals[id]
            delete deals[id]
            renumber(deals, columnIds(deals, stageId))
            const tasks = Object.fromEntries(Object.entries(s.data.tasks).filter(([, t]) => t.dealId !== id))
            const activities = Object.fromEntries(
              Object.entries(s.data.activities).filter(([, a]) => a.dealId !== id),
            )
            // contato órfão sairia do quadro mas seguiria bloqueando import/dedupe por telefone
            const orphan = contactId && !Object.values(deals).some((d) => d.contactId === contactId)
            const contacts = orphan ? withoutContact(s.data.contacts, contactId) : s.data.contacts
            // histórico de disparo das regras não guarda deal que não existe mais
            const automations = s.data.automations.map((r) => {
              if (!r.lastFiredAt || !(id in r.lastFiredAt)) return r
              const { [id]: _gone, ...lastFiredAt } = r.lastFiredAt
              return { ...r, lastFiredAt }
            })
            return { data: { ...s.data, deals, contacts, tasks, activities, automations } }
          }),

        moveDeal: (id, toStageId, overId) =>
          set((s) => {
            const deal = s.data.deals[id]
            const toStage = s.data.stages[toStageId]
            if (!deal || !toStage || overId === id) return s // soltar sobre si mesmo: nada muda
            const now = Date.now()
            const fromStageId = deal.stageId
            const changedStage = fromStageId !== toStageId
            const moved: Deal = {
              ...deal,
              stageId: toStageId,
              pipelineId: toStage.pipelineId, // etapa define o pipeline
              updatedAt: now,
              updatedBy: 'me',
            }

            if (toStage.kind === 'won' && !moved.closedAt) moved.closedAt = now
            if (toStage.kind === 'lost') moved.closedAt = now
            if (changedStage && preSaleStageIds(s.data, toStage.pipelineId).has(toStageId)) {
              moved.closedAt = null
              moved.lossReasonId = null
            }

            const deals = { ...s.data.deals, [id]: moved }
            const target = columnIds(deals, toStageId, id)
            let at = overId ? target.indexOf(overId) : -1
            // mesma coluna descendo: entra depois do alvo (semântica arrayMove do dnd-kit)
            if (at >= 0 && !changedStage) {
              const orig = columnIds(s.data.deals, toStageId)
              if (orig.indexOf(id) < orig.indexOf(overId!)) at += 1
            }
            target.splice(at >= 0 ? at : target.length, 0, id)
            renumber(deals, target)
            if (changedStage) renumber(deals, columnIds(deals, fromStageId))

            const acts = changedStage
              ? [
                  makeActivity(
                    id,
                    'stage_changed',
                    `Movido para "${toStage.name}"`,
                    [param('stage', 'text', stageName(s.data, fromStageId), toStage.name)],
                    now,
                  ),
                ]
              : []
            return { data: withActivities({ ...s.data, deals }, acts) }
          }),

        logContactToday: (id) =>
          mutate(id, (deal) => ({
            deal,
            acts: [makeActivity(id, 'contact_logged', 'Contato registrado hoje (1 clique)')],
          })),

        addNote: (id, text) =>
          mutate(id, (deal) => (text.trim() ? { deal, acts: [makeActivity(id, 'note', text.trim())] } : null)),

        setField: (id, code, value) =>
          mutate(id, (deal, data) => {
            if (sameValue(deal.custom[code], value)) return null
            const p = param(code, kindOfCode(data, code), str(deal.custom[code]), str(value))
            return {
              deal: { ...deal, custom: { ...deal.custom, [code]: value } },
              acts: [makeActivity(id, 'field_changed', 'Campo alterado', [p])],
            }
          }),

        addTag: (id, tag) =>
          mutate(id, (deal) =>
            !tag || deal.tags.includes(tag)
              ? null
              : {
                  deal: { ...deal, tags: [...deal.tags, tag] },
                  acts: [makeActivity(id, 'tag_changed', `Tag adicionada: ${tag}`, [param('tag', 'text', '', tag)])],
                },
          ),

        removeTag: (id, tag) =>
          mutate(id, (deal) =>
            !deal.tags.includes(tag)
              ? null
              : {
                  deal: { ...deal, tags: deal.tags.filter((t) => t !== tag) },
                  acts: [makeActivity(id, 'tag_changed', `Tag removida: ${tag}`, [param('tag', 'text', tag, '')])],
                },
          ),

        createTask: ({ dealId, text, kind, dueAt }) => {
          const id = `task-${uid()}`
          const now = Date.now()
          set((s) => {
            const task: Task = { id, dealId, text, kind, dueAt, completed: false, createdAt: now, updatedAt: now }
            const data = { ...s.data, tasks: { ...s.data.tasks, [id]: task } }
            const acts =
              dealId && s.data.deals[dealId]
                ? [makeActivity(dealId, 'task_created', `Tarefa criada: ${text}`, [], now)]
                : []
            return { data: withActivities(data, acts) }
          })
          return id
        },

        completeTask: (taskId, result) =>
          set((s) => {
            const task = s.data.tasks[taskId]
            if (!task || task.completed) return s
            const done: Task = { ...task, completed: true, updatedAt: Date.now() }
            if (result?.trim()) done.result = result.trim()
            const data = { ...s.data, tasks: { ...s.data.tasks, [taskId]: done } }
            const acts =
              task.dealId && s.data.deals[task.dealId]
                ? [makeActivity(task.dealId, 'task_done', `Tarefa concluída: ${task.text}`)]
                : []
            return { data: withActivities(data, acts) }
          }),

        setLoss: (id, lossReasonId) =>
          mutate(id, (deal, data) => {
            const name = data.lossReasons[lossReasonId]?.name ?? lossReasonId
            return {
              deal: { ...deal, lossReasonId },
              acts: [
                makeActivity(id, 'loss_applied', `Motivo de perda: ${name}`, [param('loss_reason', 'text', '', name)]),
              ],
            }
          }),

        importDeals: (items) => {
          const existing = new Set(
            Object.values(get().data.contacts)
              .map((c) => c.phone)
              .filter(Boolean),
          )
          const firstStage = pipelineStages(get().data)[0]?.id
          if (!firstStage) return 0
          const fresh = items.filter((it) => {
            const phone = normalizePhone(it.phone)
            if (!phone || existing.has(phone)) return false
            existing.add(phone)
            return true
          })
          if (fresh.length === 0) return 0
          set((s) => {
            const now = Date.now()
            const pipelineId = s.data.settings.defaultPipelineId
            const stageId = pipelineStages(s.data, pipelineId)[0]?.id
            if (!stageId) return s
            const sourceId = Object.values(s.data.sources).find((src) => src.name === 'Agenda de contatos')?.id ?? null
            const contacts = { ...s.data.contacts }
            const deals = { ...s.data.deals }
            let order = columnIds(deals, stageId).length
            const acts: Activity[] = []
            for (const it of fresh) {
              const contactId = `c-${uid()}`
              const id = uid()
              const name = it.customerName || 'Sem nome'
              contacts[contactId] = {
                id: contactId,
                name,
                phone: normalizePhone(it.phone),
                createdAt: now,
                updatedAt: now,
                custom: { profile: 'cliente_final' },
              }
              deals[id] = {
                id,
                pipelineId,
                stageId,
                unsorted: false,
                name,
                contactId,
                companyId: null,
                order: order++,
                priceCents: 0,
                sourceId,
                lossReasonId: null,
                currency: 'BRL',
                closedAt: null,
                custom: { brand: 'Outra', notes: 'Importado da agenda de contatos.' },
                tags: [],
                createdAt: now,
                updatedAt: now,
                createdBy: 'me',
                updatedBy: 'me',
              }
              acts.push(makeActivity(id, 'deal_created', 'Importado de vCard/CSV', [], now))
            }
            return { data: withActivities({ ...s.data, contacts, deals }, acts) }
          })
          return fresh.length
        },

        replaceAll: (data) => set({ data: withSeedDefaults(data) }),
        resetSeed: () => set({ data: seedCrmData() }),

        upsertStage: (stage) => set((s) => ({ data: { ...s.data, stages: { ...s.data.stages, [stage.id]: stage } } })),

        removeStage: (id) =>
          set((s) => {
            const stage = s.data.stages[id]
            if (!stage?.editable || Object.values(s.data.deals).some((d) => d.stageId === id)) return s
            const stages = { ...s.data.stages }
            delete stages[id]
            return { data: { ...s.data, stages } }
          }),

        upsertCustomField: (field) =>
          set((s) => ({ data: { ...s.data, customFields: { ...s.data.customFields, [field.id]: field } } })),

        upsertAutomation: (rule) =>
          set((s) => {
            const exists = s.data.automations.some((r) => r.id === rule.id)
            const automations = exists
              ? s.data.automations.map((r) => (r.id === rule.id ? rule : r))
              : [...s.data.automations, rule]
            return { data: { ...s.data, automations } }
          }),

        createDealFromTemplate: (template, atStageId, sourceDealId) => {
          const { data } = get()
          const src = data.deals[sourceDealId]
          const stage = data.stages[atStageId]
          if (!src || !stage) return null
          const id = uid()
          const now = Date.now()
          const label = template === 'posvenda' ? 'pós-venda' : 'garantia'
          const name = `${src.name} — ${label}`
          const inherited = Object.fromEntries(
            ['part_code', 'application', 'brand'].filter((k) => k in src.custom).map((k) => [k, src.custom[k]]),
          )
          set((s) => {
            const deal: Deal = {
              id,
              pipelineId: stage.pipelineId,
              stageId: atStageId,
              unsorted: false,
              name,
              contactId: src.contactId,
              companyId: src.companyId,
              order: columnIds(s.data.deals, atStageId).length,
              priceCents: 0,
              sourceId: src.sourceId,
              lossReasonId: null,
              currency: 'BRL',
              closedAt: isClosedStage(s.data, atStageId) ? now : null,
              custom: { ...inherited, notes: `Gerado por automação a partir de "${src.name}".` },
              tags: [],
              createdAt: now,
              updatedAt: now,
              createdBy: 'me',
              updatedBy: 'me',
            }
            const act = makeActivity(id, 'deal_created', `Criado por automação (${label})`, [param('name', 'text', '', name)], now)
            return { data: withActivities({ ...s.data, deals: { ...s.data.deals, [id]: deal } }, [act]) }
          })
          return id
        },
      }
      return withAutomationEvents(base, get)
    },
    {
      name: PERSIST_KEY,
      storage: crmStorage,
      version: 2,
      partialize: (s) => ({ data: s.data }),
      migrate: (persisted, version) => persistMigrate(persisted, version) as unknown as CrmState,
      merge: persistMerge,
    },
  ),
)

// ---------- automações (motor ↔ store) ----------
// Ações que geram eventos são envolvidas por withAutomationEvents (compara antes/depois)
// e o motor roda após a mutação. SEM CASCATA: enquanto o motor executa ações, os eventos
// que elas geram são ignorados (trava `running`) — evita loops entre regras e efeitos como
// a tag posta por uma regra reavaliar regras de tag.

let running = false

const engineCtx = (data: CrmData, now: number): EngineCtx => ({
  data,
  now,
  lastContactMs: (dealId) => lastContactMsOf(data, dealId),
})

const engineApi = (): EngineApi => {
  const s = useCrmStore.getState()
  return {
    createTask: s.createTask,
    moveDeal: (id, to) => s.moveDeal(id, to),
    setField: s.setField,
    addTag: s.addTag,
    removeTag: s.removeTag,
    addNote: s.addNote,
    createDealFromTemplate: s.createDealFromTemplate,
  }
}

/** Grava lastFiredAt e executa as ações; erro numa regra não derruba a ação do usuário. */
const commitFired = (fired: FiredAction[], now: number) => {
  if (fired.length === 0) return
  useCrmStore.setState((s) => ({ data: { ...s.data, automations: markFired(s.data.automations, fired, now) } }))
  try {
    applyFiredActions(fired, engineApi(), now)
  } catch (e) {
    console.error('[crm] falha ao executar automação', e)
  }
}

/** Avalia e executa as regras de um evento de negócio. No-op se já houver automação em curso. */
export function runAutomations(event: EngineEvent): void {
  if (running) return
  running = true
  try {
    const now = Date.now()
    commitFired(evaluateRules(engineCtx(useCrmStore.getState().data, now), event), now)
  } finally {
    running = false
  }
}

/** Avalia e executa as regras de tempo (dias sem contato, tarefa atrasada). Devolve nº de ações. */
export function runAutomationTick(now = Date.now()): number {
  if (running) return 0
  running = true
  try {
    const fired = evaluateTick(engineCtx(useCrmStore.getState().data, now))
    commitFired(fired, now)
    return fired.length
  } finally {
    running = false
  }
}

/** Diferenças de campos customizados (deal e contato) viram eventos field_changed. */
const emitFieldChanges = (before: CrmData, after: CrmData, dealId: string) => {
  const diff = (a: Record<string, FieldValue> = {}, b: Record<string, FieldValue> = {}) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => !sameValue(a[k], b[k]))
      .map((k) => [k, a[k], b[k]] as const)
  const contactOf = (d: CrmData) => {
    const cid = d.deals[dealId]?.contactId
    return cid ? d.contacts[cid] : undefined
  }
  const changes = [
    ...diff(before.deals[dealId]?.custom, after.deals[dealId]?.custom),
    ...diff(contactOf(before)?.custom, contactOf(after)?.custom),
  ]
  for (const [fieldCode, oldV, newV] of changes) {
    runAutomations({ kind: 'field_changed', dealId, at: Date.now(), fieldCode, oldValue: str(oldV), newValue: str(newV) })
  }
}

function withAutomationEvents(base: CrmState, get: () => CrmState): CrmState {
  const at = () => Date.now()
  const createdSince = (before: CrmData) => Object.keys(get().data.deals).filter((id) => !(id in before.deals))
  return {
    ...base,
    addDeal: (input) => {
      const id = base.addDeal(input)
      runAutomations({ kind: 'deal_created', dealId: id, at: at() })
      return id
    },
    importDeals: (items) => {
      const before = get().data
      const added = base.importDeals(items)
      for (const id of createdSince(before)) runAutomations({ kind: 'deal_created', dealId: id, at: at() })
      return added
    },
    createDealFromTemplate: (template, atStageId, sourceDealId) => {
      const id = base.createDealFromTemplate(template, atStageId, sourceDealId)
      if (id) runAutomations({ kind: 'deal_created', dealId: id, at: at() })
      return id
    },
    moveDeal: (id, toStageId, overId) => {
      const from = get().data.deals[id]?.stageId
      base.moveDeal(id, toStageId, overId)
      const to = get().data.deals[id]?.stageId
      if (from && to && from !== to) {
        runAutomations({ kind: 'stage_changed', dealId: id, at: at(), oldValue: from, newValue: to })
      }
    },
    updateDeal: (id, patch) => {
      const before = get().data
      base.updateDeal(id, patch)
      emitFieldChanges(before, get().data, id)
    },
    setField: (id, code, value) => {
      const before = get().data
      base.setField(id, code, value)
      emitFieldChanges(before, get().data, id)
    },
    addTag: (id, tag) => {
      const had = get().data.deals[id]?.tags.includes(tag)
      base.addTag(id, tag)
      if (!had && get().data.deals[id]?.tags.includes(tag)) {
        runAutomations({ kind: 'tag_changed', dealId: id, at: at(), oldValue: '', newValue: tag })
      }
    },
    removeTag: (id, tag) => {
      const had = get().data.deals[id]?.tags.includes(tag)
      base.removeTag(id, tag)
      if (had && !get().data.deals[id]?.tags.includes(tag)) {
        runAutomations({ kind: 'tag_changed', dealId: id, at: at(), oldValue: tag, newValue: '' })
      }
    },
  }
}

/**
 * Tick das regras de tempo: ao montar, a cada `intervalMs` e ao voltar para a aba — só com a
 * página visível. Ticks extras são inofensivos (cooldown/episódio evitam duplicar ações).
 */
export function useAutomationTick(intervalMs = 60 * 60 * 1000) {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') runAutomationTick()
    }
    tick()
    const timer = setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs])
}

/** Visão derivada de um deal p/ UI (memoizada sobre `data`; selector estável). */
export function useDealView(id: string | null): DealView | null {
  const data = useCrmStore((s) => s.data)
  return useMemo(() => (id ? buildDealView(data, id) : null), [data, id])
}
