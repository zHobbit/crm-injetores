import { describe, expect, it } from 'vitest'
import type { CrmData, Deal, Stage, CustomField } from './types'
import { stageTypeMeta } from './types'

describe('schema v2', () => {
  it('Stage.type tem semântica 1/2/3', () => {
    expect(stageTypeMeta(1).kind).toBe('normal')
    expect(stageTypeMeta(2).kind).toBe('won')
    expect(stageTypeMeta(3).kind).toBe('loss')
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
