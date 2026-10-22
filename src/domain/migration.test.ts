import { describe, expect, it } from 'vitest'
import { dealsV1ToCrmDataV2, isV1State } from './migration'
import type { DealV1 } from './types'
import { SEED_DEALS_V1 } from './migrationFixtures'

describe('dealsV1ToCrmDataV2', () => {
  const now = Date.parse('2026-10-22T12:00:00Z')
  const data = dealsV1ToCrmDataV2(SEED_DEALS_V1, now)
  it('cria contato por deal com telefone normalizado e perfil em custom.profile', () => {
    const d = data.deals['seed-1']
    const c = data.contacts[d.contactId!]
    expect(c.name).toBe('Diesel Bomar Ltda')
    expect(c.phone).toBe('5581999881122')
    expect(c.custom['profile']).toBe('bombista')
  })
  it('deal v2 referencia pipeline padrão, campos migram para custom por code', () => {
    const d = data.deals['seed-1']
    expect(d.pipelineId).toBe(data.settings.defaultPipelineId)
    expect(d.stageId).toBe('triage')
    expect(d.priceCents).toBe(320000)
    expect(d.custom['part_code']).toBe('0445110376')
    expect(d.custom['brand']).toBe('Bosch')
    expect(d.custom['notes']).toContain('4 unidades')
    expect(d.name).toBe('Diesel Bomar Ltda')
  })
  it('activityLog vira activities tipadas com diff de etapa', () => {
    const acts = Object.values(data.activities).filter((a) => a.dealId === 'seed-1')
    expect(acts[0].type).toBe('deal_created')
    const moved = Object.values(data.activities).find((a) => a.type === 'stage_changed')
    expect(moved?.params[0]).toMatchObject({ fieldId: 'stage', kind: 'text' })
  })
  it('closedAt ISO vira ms; won ganha closedAt', () => {
    const won = data.deals['seed-8']
    expect(won.closedAt).toBe(Date.parse('2026-10-17'))  // atualizar p/ valor real do fixture
    expect(won.stageId).toBe('won')
  })
  it('ids estáveis e sem colisão (deal, contato, atividade)', () => {
    expect(Object.keys(data.contacts)).toHaveLength(10)
    const ids = Object.values(data.activities).map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
describe('isV1State', () => {
  it('aceita estado com deals[].stage string', () => {
    expect(isV1State({ deals: SEED_DEALS_V1 })).toBe(true)
    expect(isV1State({ deals: [] })).toBe(false)
    expect(isV1State({ version: 2, deals: {} })).toBe(false)
  })
})
