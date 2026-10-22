import { describe, expect, it } from 'vitest'
import { seedCrmData } from './seed'
import { stageTypeMeta } from '../domain/types'

describe('seedCrmData', () => {
  const data = seedCrmData()
  it('1 pipeline principal com 7 etapas mapeadas do STAGES atual', () => {
    const pipe = Object.values(data.pipelines)[0]
    expect(pipe.isMain).toBe(true)
    expect(Object.keys(data.stages)).toHaveLength(7)
    expect(data.stages['triage'].name).toContain('Triagem')
    expect(stageTypeMeta(data.stages['won'].type).kind).toBe('won')
    expect(data.stages['warranty'].emoji).toBe('🛡️')
  })
  it('campos customizados migram os campos fixos atuais', () => {
    const byCode = Object.fromEntries(Object.values(data.customFields).map((f) => [f.code, f]))
    expect(byCode['profile'].kind).toBe('select')
    expect(byCode['profile'].scopes).toContain('contact')
    expect(byCode['profile'].enums.map((e) => e.value)).toEqual(['bombista','mecanico','revendedor','cliente_final'])
    expect(byCode['brand'].kind).toBe('select')
    expect(byCode['part_code'].kind).toBe('text')
    expect(byCode['application'].kind).toBe('text')
    expect(byCode['notes'].kind).toBe('textarea')
  })
  it('10 deals, 10 contatos, atividades com author', () => {
    expect(Object.keys(data.deals)).toHaveLength(10)
    expect(Object.keys(data.contacts)).toHaveLength(10)
    const deal = Object.values(data.deals)[0]
    expect(deal.contactId).not.toBeNull()
    expect(deal.custom['part_code']).toBe('0445110376')
    expect(Object.values(data.activities).every((a) => a.authorName === 'me')).toBe(true)
  })
  it('motivos de perda e fontes pré-definidos', () => {
    expect(Object.keys(data.lossReasons).length).toBeGreaterThanOrEqual(3)
    expect(Object.values(data.sources).some((s) => s.name === 'WhatsApp')).toBe(true)
  })
})
