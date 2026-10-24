import { describe, expect, it } from 'vitest'
import { parseSnapshot } from './exportImport'
import { seedCrmData } from '../store/seed'
import { SEED_DEALS_V1 } from '../domain/migrationFixtures'

describe('parseSnapshot', () => {
  it('aceita v2 e v1', () => {
    const data = seedCrmData()
    expect(parseSnapshot({ schemaVersion: 2, data }).deals).toEqual(data.deals)
    expect(Object.keys(parseSnapshot({ deals: SEED_DEALS_V1 }).deals)).toHaveLength(10)
  })
  it('aceita backup v1 vazio', () => {
    expect(Object.keys(parseSnapshot({ schemaVersion: 1, deals: [] }).deals)).toHaveLength(0)
  })
  it('não saneia (isso é do replaceAll): devolve os deals como vieram', () => {
    const data = seedCrmData()
    const ghost = { ...data.deals['seed-1'], id: 'ghost', stageId: 'nope' }
    expect(parseSnapshot({ schemaVersion: 2, data: { ...data, deals: { ...data.deals, ghost } } }).deals['ghost']).toBeDefined()
  })
  it('rejeita v2 sem etapas', () => {
    const data = seedCrmData()
    expect(() => parseSnapshot({ schemaVersion: 2, data: { ...data, stages: undefined } })).toThrow()
  })
})
