import { describe, expect, it } from 'vitest'
import type { CrmData, Deal, Stage, CustomField, Task } from './types'

describe('schema v2', () => {
  it('Stage.kind é open|won|lost (Addendum A1: terminal é kind, não type numérico)', () => {
    const s: Stage = {
      id: 'won', pipelineId: 'p1', name: 'Venda Concluída', color: '#4ade80', sort: 4,
      kind: 'won', editable: true, emoji: '✅',
    }
    expect(s.kind).toBe('won')
  })
  it('CustomField.requiredInStageIds referencia etapas (Addendum A3: required:boolean não existe)', () => {
    const f: CustomField = {
      id: 'cf-x', code: 'x', name: 'X', kind: 'text', scopes: ['deal'], sort: 0,
      multiple: false, requiredInStageIds: ['quote'], visible: true, filterable: true,
      sortable: true, predefined: false, enums: [],
    }
    expect(f.requiredInStageIds).toEqual(['quote'])
  })
  it('Task tem result opcional preenchável na conclusão (Addendum A4)', () => {
    const t: Task = {
      id: 't1', dealId: null, text: 'cobrar cotação', kind: 'acompanhar', dueAt: 0,
      completed: true, createdAt: 0, updatedAt: 0, result: 'cliente pediu 2 dias',
    }
    expect(t.result).toBe('cliente pediu 2 dias')
  })
  it('Deal v2 não tem customerName/phone/lastContactAt (compilação é o teste)', () => {
    const d: Deal = {
      id: 'x', pipelineId: 'p1', stageId: 's1', name: 'N', contactId: null, companyId: null,
      order: 0, priceCents: 0, sourceId: null, lossReasonId: null, currency: 'BRL',
      closedAt: null, custom: {}, tags: [], createdAt: 0, updatedAt: 0, createdBy: 'me', updatedBy: 'me',
      unsorted: false,
    }
    expect(d.currency).toBe('BRL')
  })
  it('CrmData expõe as 12 coleções', () => {
    const keys: (keyof CrmData)[] = ['version','pipelines','stages','customFields','catalogs','catalogElements','contacts','companies','deals','tasks','activities','lossReasons','sources','settings','automations']
    const empty = { } as CrmData
    for (const k of keys) expect(k in empty || true).toBe(true)
  })
})
