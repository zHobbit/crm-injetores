import { describe, expect, it, vi } from 'vitest'
import {
  applyFiredActions,
  evaluateRules,
  evaluateTick,
  markFired,
  matchesCondition,
  type EngineApi,
  type EngineCtx,
  type FiredAction,
} from './automationEngine'
import { seedCrmData } from '../store/seed'
import { endOfDay } from 'date-fns'
import { msDay } from './format'
import type { AutomationRule, CrmData, Deal, Task } from './types'

const NOW = Date.parse('2026-10-24T12:00:00Z')

/** Seed com 1 deal controlado (`d1`) e contato próprio; regras do seed por padrão. */
function setup(over: Partial<Deal> = {}, profile = 'mecanico', rules?: AutomationRule[]) {
  const data = seedCrmData()
  const deal: Deal = {
    ...data.deals['seed-1'],
    id: 'd1',
    stageId: 'quote',
    priceCents: 320000,
    contactId: 'c-d1',
    custom: { brand: 'Bosch', part_code: '0445110376' },
    tags: [],
    ...over,
  }
  const out: CrmData = {
    ...data,
    deals: { d1: deal },
    contacts: { 'c-d1': { id: 'c-d1', name: 'X', phone: '5581999990000', createdAt: 0, updatedAt: 0, custom: { profile } } },
    tasks: {},
    automations: rules ?? data.automations,
  }
  return out
}

const ctxOf = (data: CrmData, lastContactAgoDays = 0): EngineCtx => ({
  data,
  now: NOW,
  lastContactMs: () => NOW - lastContactAgoDays * msDay,
})

const rule = (data: CrmData, id: string) => data.automations.find((r) => r.id === id)!
const ids = (fired: FiredAction[]) => fired.map((f) => `${f.ruleId}:${f.action.kind}`)

describe('matchesCondition', () => {
  const data = setup()
  const deal = data.deals['d1']
  const ctx = ctxOf(data)

  it('stage in', () => {
    expect(matchesCondition({ field: 'stage', op: 'in', value: ['quote', 'waiting'] }, deal, ctx)).toBe(true)
    expect(matchesCondition({ field: 'stage', op: 'in', value: ['won'] }, deal, ctx)).toBe(false)
  })

  it('price gt/lt/between em centavos', () => {
    expect(matchesCondition({ field: 'price', op: 'gt', value: 500000 }, deal, ctx)).toBe(false)
    expect(matchesCondition({ field: 'price', op: 'lt', value: 500000 }, deal, ctx)).toBe(true)
    expect(matchesCondition({ field: 'price', op: 'between', value: [300000, 320000] }, deal, ctx)).toBe(true)
    expect(matchesCondition({ field: 'price', op: 'between', value: [320001, 900000] }, deal, ctx)).toBe(false)
  })

  it('custom lê deal.custom[code]: eq / contains / filled / not_filled', () => {
    expect(matchesCondition({ field: 'custom', fieldCode: 'brand', op: 'eq', value: 'Bosch' }, deal, ctx)).toBe(true)
    expect(matchesCondition({ field: 'custom', fieldCode: 'part_code', op: 'contains', value: '5110' }, deal, ctx)).toBe(true)
    expect(matchesCondition({ field: 'custom', fieldCode: 'application', op: 'filled' }, deal, ctx)).toBe(false)
    expect(matchesCondition({ field: 'custom', fieldCode: 'application', op: 'not_filled' }, deal, ctx)).toBe(true)
  })

  it('has_tag lê deal.tags; profile lê o contato; source lê sourceId', () => {
    const tagged = { ...deal, tags: ['aguardando'], sourceId: 'src-1' }
    expect(matchesCondition({ field: 'has_tag', op: 'has', value: 'aguardando' }, tagged, ctx)).toBe(true)
    expect(matchesCondition({ field: 'has_tag', op: 'has_not', value: 'aguardando' }, tagged, ctx)).toBe(false)
    expect(matchesCondition({ field: 'profile', op: 'is', value: 'mecanico' }, deal, ctx)).toBe(true)
    expect(matchesCondition({ field: 'profile', op: 'is_not', value: 'mecanico' }, deal, ctx)).toBe(false)
    expect(matchesCondition({ field: 'source', op: 'in', value: ['src-1'] }, tagged, ctx)).toBe(true)
  })

  it('deal sem contato: profile is → false, is_not → true', () => {
    const orphan = { ...deal, contactId: null }
    expect(matchesCondition({ field: 'profile', op: 'is', value: 'mecanico' }, orphan, ctx)).toBe(false)
    expect(matchesCondition({ field: 'profile', op: 'is_not', value: 'mecanico' }, orphan, ctx)).toBe(true)
  })
})

describe('evaluateRules', () => {
  it('regra 2: stage_changed → quote (por nome ou id) gera task + tag, na ordem das ações', () => {
    const data = setup()
    const ctx = ctxOf(data)
    const byName = evaluateRules(ctx, { kind: 'stage_changed', dealId: 'd1', at: NOW, newValue: 'Cotação Enviada' })
    expect(ids(byName)).toEqual(['auto-2:create_task', 'auto-2:add_tag'])
    const byId = evaluateRules(ctx, { kind: 'stage_changed', dealId: 'd1', at: NOW, newValue: 'quote' })
    expect(ids(byId)).toEqual(ids(byName))
    expect(evaluateRules(ctx, { kind: 'stage_changed', dealId: 'd1', at: NOW, newValue: 'waiting' })).toEqual([])
  })

  it('cooldown: dentro da janela não dispara; depois dispara', () => {
    const base = setup()
    const withCooldown = (last: number) => ({
      ...base,
      automations: base.automations.map((r) =>
        r.id === 'auto-2' ? { ...r, cooldown: 86400 as const, lastFiredAt: { d1: last } } : r,
      ),
    })
    const ev = { kind: 'stage_changed' as const, dealId: 'd1', at: NOW, newValue: 'quote' }
    expect(evaluateRules(ctxOf(withCooldown(NOW - 1000)), ev)).toEqual([])
    expect(ids(evaluateRules(ctxOf(withCooldown(NOW - 90_000_000)), ev))).toContain('auto-2:create_task')
  })

  it('regra 1: deal_created com contato revendedor → task "montar tabela de revenda" em 2 dias', () => {
    const fired = evaluateRules(ctxOf(setup({}, 'revendedor')), { kind: 'deal_created', dealId: 'd1', at: NOW })
    expect(fired).toEqual([
      { ruleId: 'auto-1', dealId: 'd1', action: { kind: 'create_task', text: 'montar tabela de revenda', kindTag: 'cotacao', inDays: 2 } },
    ])
    expect(evaluateRules(ctxOf(setup({}, 'mecanico')), { kind: 'deal_created', dealId: 'd1', at: NOW })).toEqual([])
  })

  it('regra 6: tag adicionada "retorno-antecipado" → garantia; remoção não dispara', () => {
    const data = setup({ tags: ['retorno-antecipado'] })
    const added = evaluateRules(ctxOf(data), { kind: 'tag_changed', dealId: 'd1', at: NOW, oldValue: '', newValue: 'retorno-antecipado' })
    expect(ids(added)).toEqual(['auto-6:change_stage', 'auto-6:create_task'])
    const removed = evaluateRules(ctxOf(setup()), { kind: 'tag_changed', dealId: 'd1', at: NOW, oldValue: 'retorno-antecipado', newValue: '' })
    expect(removed).toEqual([])
  })

  it('field_changed casa por fieldCode; regra desabilitada e pipeline diferente não disparam', () => {
    const custom: AutomationRule = {
      id: 'r-f', name: 'f', enabled: true, dealPipelineId: 'any',
      trigger: { kind: 'field_changed', fieldCode: 'brand' },
      conditions: { logic: 'or', items: [] },
      actions: [{ kind: 'add_note', text: 'marca mudou' }],
    }
    const ev = { kind: 'field_changed' as const, dealId: 'd1', at: NOW, fieldCode: 'brand', oldValue: 'Bosch', newValue: 'Delphi' }
    expect(ids(evaluateRules(ctxOf(setup({}, 'mecanico', [custom])), ev))).toEqual(['r-f:add_note'])
    expect(evaluateRules(ctxOf(setup({}, 'mecanico', [custom])), { ...ev, fieldCode: 'part_code' })).toEqual([])
    expect(evaluateRules(ctxOf(setup({}, 'mecanico', [{ ...custom, enabled: false }])), ev)).toEqual([])
    expect(evaluateRules(ctxOf(setup({}, 'mecanico', [{ ...custom, dealPipelineId: 'outro' }])), ev)).toEqual([])
  })

  it('lógica or: basta uma condição; and: todas', () => {
    const r = (logic: 'and' | 'or'): AutomationRule => ({
      id: 'r', name: 'r', enabled: true, dealPipelineId: 'any', trigger: { kind: 'deal_created' },
      conditions: { logic, items: [{ field: 'stage', op: 'in', value: ['quote'] }, { field: 'price', op: 'gt', value: 10_000_000 }] },
      actions: [{ kind: 'add_tag', tag: 'x' }],
    })
    const ev = { kind: 'deal_created' as const, dealId: 'd1', at: NOW }
    expect(evaluateRules(ctxOf(setup({}, 'mecanico', [r('or')])), ev)).toHaveLength(1)
    expect(evaluateRules(ctxOf(setup({}, 'mecanico', [r('and')])), ev)).toHaveLength(0)
  })

  it('deal inexistente → nada', () => {
    expect(evaluateRules(ctxOf(setup()), { kind: 'deal_created', dealId: 'nope', at: NOW })).toEqual([])
  })
})

describe('evaluateTick', () => {
  it('regra 3: 8 dias sem contato em waiting → open_whatsapp; em won → nada', () => {
    expect(ids(evaluateTick(ctxOf(setup({ stageId: 'waiting' }), 8)))).toEqual(['auto-3:open_whatsapp'])
    expect(evaluateTick(ctxOf(setup({ stageId: 'won' }), 8))).toEqual([])
    expect(evaluateTick(ctxOf(setup({ stageId: 'waiting' }), 6))).toEqual([])
  })

  it('16 dias: regra 3 e regra 4 (reativar / encerrar + nota)', () => {
    expect(ids(evaluateTick(ctxOf(setup({ stageId: 'quote' }), 16)))).toEqual([
      'auto-3:open_whatsapp',
      'auto-4:create_task',
      'auto-4:add_note',
    ])
  })

  it('regra de tempo SEM cooldown dispara uma vez por período sem contato e rearma após novo contato', () => {
    const base = setup({ stageId: 'triage' })
    const fired = (lastFired: number | undefined, contactAgoDays: number) => {
      const data = {
        ...base,
        automations: base.automations.map((r) => (r.id === 'auto-4' ? { ...r, lastFiredAt: lastFired ? { d1: lastFired } : {} } : r)),
      }
      return ids(evaluateTick(ctxOf(data, contactAgoDays))).filter((x) => x.startsWith('auto-4'))
    }
    expect(fired(undefined, 16)).toHaveLength(2)
    expect(fired(NOW - 3600_000, 16)).toEqual([]) // já disparou neste período
    // disparou há 40 dias, mas houve contato há 16 (depois do disparo) → novo período
    expect(fired(NOW - 40 * msDay, 16)).toHaveLength(2)
  })

  it('regra de tempo COM cooldown respeita a janela (auto-3 diária)', () => {
    const base = setup({ stageId: 'waiting' })
    const data = (last: number) => ({
      ...base,
      automations: base.automations.map((r) => (r.id === 'auto-3' ? { ...r, lastFiredAt: { d1: last } } : r)),
    })
    expect(evaluateTick(ctxOf(data(NOW - 3600_000), 8))).toEqual([])
    expect(ids(evaluateTick(ctxOf(data(NOW - 25 * 3600_000), 8)))).toEqual(['auto-3:open_whatsapp'])
  })

  it('task_overdue: tarefa vencida e aberta dispara uma vez por tarefa que vence', () => {
    const overdue: AutomationRule = {
      id: 'r-o', name: 'atraso', enabled: true, dealPipelineId: 'any', trigger: { kind: 'task_overdue' },
      conditions: { logic: 'and', items: [] }, actions: [{ kind: 'add_tag', tag: 'atrasado' }],
    }
    const task = (id: string, dueAt: number, completed = false): Task => ({
      id, dealId: 'd1', text: 't', kind: 'acompanhar', dueAt, completed, createdAt: 0, updatedAt: 0,
    })
    const mk = (tasks: Task[], lastFired?: number) => ({
      ...setup({}, 'mecanico', [{ ...overdue, lastFiredAt: lastFired ? { d1: lastFired } : {} }]),
      tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    })
    expect(ids(evaluateTick(ctxOf(mk([task('t1', NOW - 1000)]))))).toEqual(['r-o:add_tag'])
    expect(evaluateTick(ctxOf(mk([task('t1', NOW - 1000, true)])))).toEqual([]) // concluída
    expect(evaluateTick(ctxOf(mk([task('t1', NOW + msDay)])))).toEqual([]) // ainda no prazo
    expect(evaluateTick(ctxOf(mk([task('t1', NOW - 5000)], NOW - 1000)))).toEqual([]) // já disparou p/ ela
    expect(ids(evaluateTick(ctxOf(mk([task('t1', NOW - 5 * msDay), task('t2', NOW - 1000)], NOW - 2 * msDay))))).toEqual([
      'r-o:add_tag', // t2 venceu depois do último disparo
    ])
  })
})

describe('markFired', () => {
  it('grava lastFiredAt por regra e deal, sem mutar as regras originais', () => {
    const data = setup()
    const before = rule(data, 'auto-2').lastFiredAt
    const fired = evaluateRules(ctxOf(data), { kind: 'stage_changed', dealId: 'd1', at: NOW, newValue: 'quote' })
    const next = markFired(data.automations, fired, NOW)
    expect(next.find((r) => r.id === 'auto-2')!.lastFiredAt).toEqual({ d1: NOW })
    expect(rule(data, 'auto-2').lastFiredAt).toBe(before)
    expect(next.find((r) => r.id === 'auto-1')).toBe(rule(data, 'auto-1')) // intocada mantém referência
  })
})

describe('applyFiredActions', () => {
  const api = (): EngineApi => ({
    createTask: vi.fn(),
    moveDeal: vi.fn(),
    setField: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    addNote: vi.fn(),
    createDealFromTemplate: vi.fn(),
  })
  const f = (action: FiredAction['action']): FiredAction => ({ ruleId: 'r', dealId: 'd1', action })

  it('chama a API certa com os argumentos certos', () => {
    const a = api()
    applyFiredActions(
      [
        f({ kind: 'create_task', text: 'cobrar cotação', kindTag: 'acompanhar', inDays: 3 }),
        f({ kind: 'change_stage', toStageId: 'warranty' }),
        f({ kind: 'set_field', fieldCode: 'brand', value: 'Delphi' }),
        f({ kind: 'add_tag', tag: 'aguardando' }),
        f({ kind: 'remove_tag', tag: 'velha' }),
        f({ kind: 'add_note', text: 'nota' }),
        f({ kind: 'create_deal', template: 'posvenda', atStageId: 'postsale' }),
      ],
      a,
      NOW,
    )
    expect(a.createTask).toHaveBeenCalledWith({ dealId: 'd1', text: 'cobrar cotação', kind: 'acompanhar', dueAt: endOfDay(NOW + 3 * msDay).getTime() })
    expect(a.moveDeal).toHaveBeenCalledWith('d1', 'warranty')
    expect(a.setField).toHaveBeenCalledWith('d1', 'brand', 'Delphi')
    expect(a.addTag).toHaveBeenCalledWith('d1', 'aguardando')
    expect(a.removeTag).toHaveBeenCalledWith('d1', 'velha')
    expect(a.addNote).toHaveBeenCalledWith('d1', 'nota')
    expect(a.createDealFromTemplate).toHaveBeenCalledWith('posvenda', 'postsale', 'd1')
  })

  it('open_whatsapp vira tarefa "acompanhar" para hoje + nota com o modelo', () => {
    const a = api()
    applyFiredActions([f({ kind: 'open_whatsapp', template: 'Olá!' })], a, NOW)
    expect(a.createTask).toHaveBeenCalledWith({ dealId: 'd1', text: 'Follow-up WhatsApp: Olá!', kind: 'acompanhar', dueAt: endOfDay(NOW).getTime() })
    expect(a.addNote).toHaveBeenCalledWith('d1', 'Follow-up WhatsApp: Olá!')
  })

  it('preserva a ordem das ações', () => {
    const order: string[] = []
    const a: EngineApi = {
      ...api(),
      createTask: () => void order.push('task'),
      addTag: () => void order.push('tag'),
    }
    applyFiredActions([f({ kind: 'create_task', text: 't', kindTag: 'acompanhar', inDays: 0 }), f({ kind: 'add_tag', tag: 'x' })], a, NOW)
    expect(order).toEqual(['task', 'tag'])
  })
})

describe('correções da revisão do motor', () => {
  it('tag_changed com tag no gatilho só dispara para aquela tag (regra 6 não repete ao ganhar outra tag)', () => {
    const data = setup({ tags: ['retorno-antecipado', 'aguardando'] })
    const other = evaluateRules(ctxOf(data), { kind: 'tag_changed', dealId: 'd1', at: NOW, oldValue: '', newValue: 'aguardando' })
    expect(ids(other)).toEqual([])
    const same = evaluateRules(ctxOf(data), { kind: 'tag_changed', dealId: 'd1', at: NOW, oldValue: '', newValue: 'retorno-antecipado' })
    expect(ids(same)).toEqual(['auto-6:change_stage', 'auto-6:create_task'])
  })

  it('tarefa criada por regra vence no fim do dia (inDays 0 não nasce atrasada)', () => {
    const calls: { dueAt: number | null }[] = []
    const api: EngineApi = {
      createTask: (i) => void calls.push(i), moveDeal: () => {}, setField: () => {}, addTag: () => {},
      removeTag: () => {}, addNote: () => {}, createDealFromTemplate: () => {},
    }
    applyFiredActions([{ ruleId: 'r', dealId: 'd1', action: { kind: 'create_task', text: 't', kindTag: 'acompanhar', inDays: 0 } }], api, NOW)
    expect(calls[0].dueAt).toBeGreaterThan(NOW)
    expect(calls[0].dueAt).toBe(endOfDay(NOW).getTime())
  })
})
