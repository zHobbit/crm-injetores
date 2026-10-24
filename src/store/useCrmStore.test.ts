import { localStorageMock } from '../test/localStorage.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crmStorage, lastContactMsOf, persistMigrate, useCrmStore, type DealInput2 } from './useCrmStore'
import { seedCrmData } from './seed'
import { SEED_DEALS_V1 } from '../domain/migrationFixtures'
import { fmtBRL, msDay } from '../domain/format'

const st = () => useCrmStore.getState()
const actsOf = (dealId: string) =>
  Object.values(st().data.activities)
    .filter((a) => a.dealId === dealId)
    .sort((a, b) => a.createdAt - b.createdAt)
const lastAct = (dealId: string) => actsOf(dealId).at(-1)!

const input = (p: Partial<DealInput2> = {}): DealInput2 => ({
  name: 'Oficina Teste',
  phone: '81 98888-7777',
  pipelineId: 'pipe-main',
  stageId: 'triage',
  priceCents: 320000,
  custom: { part_code: '0445110376', brand: 'Bosch' },
  contactCustom: { profile: 'mecanico' },
  ...p,
})

beforeEach(() => {
  useCrmStore.setState({ data: seedCrmData() })
  crmStorage.flush() // gravação agrupada: zera pendência entre testes
  localStorageMock.clear()
})

describe('useCrmStore v2', () => {
  it('addDeal cria Deal + Contact + Activity deal_created; telefone repetido reutiliza contato', () => {
    const id = st().addDeal(input())
    const deal = st().data.deals[id]
    const contact = st().data.contacts[deal.contactId!]
    expect(contact.phone).toBe('5581988887777')
    expect(contact.custom['profile']).toBe('mecanico')
    expect(deal.closedAt).toBeNull()
    const created = actsOf(id).find((a) => a.type === 'deal_created')!
    expect(created.params.map((p) => p.fieldId)).toEqual(expect.arrayContaining(['name', 'phone']))

    const id2 = st().addDeal(input({ name: 'Outra cotação', phone: '(81) 98888-7777' }))
    expect(st().data.deals[id2].contactId).toBe(deal.contactId)
  })

  it('updateDeal muda preço → field_changed com diff formatado', () => {
    const id = st().addDeal(input())
    st().updateDeal(id, { priceCents: 450000 })
    expect(st().data.deals[id].priceCents).toBe(450000)
    const act = lastAct(id)
    expect(act.type).toBe('field_changed')
    expect(act.params).toEqual([
      expect.objectContaining({ fieldId: 'price', oldValue: fmtBRL(320000), newValue: fmtBRL(450000) }),
    ])
  })

  it('updateDeal sem mudança não gera Activity; telefone novo atualiza o mesmo contato', () => {
    const id = st().addDeal(input())
    const before = actsOf(id).length
    st().updateDeal(id, { priceCents: 320000 })
    expect(actsOf(id)).toHaveLength(before)
    const contactId = st().data.deals[id].contactId!
    st().updateDeal(id, { phone: '81 97777-6666' })
    expect(st().data.deals[id].contactId).toBe(contactId)
    expect(st().data.contacts[contactId].phone).toBe('5581977776666')
  })

  it('moveDeal para won seta closedAt + stage_changed com nomes; volta p/ triage zera', () => {
    const id = st().addDeal(input())
    st().moveDeal(id, 'won')
    const won = st().data.deals[id]
    expect(won.stageId).toBe('won')
    expect(won.closedAt).not.toBeNull()
    expect(lastAct(id).params[0]).toMatchObject({
      fieldId: 'stage',
      oldValue: 'Triagem / Novo Contato',
      newValue: 'Venda Concluída',
    })
    st().moveDeal(id, 'postsale')
    expect(st().data.deals[id].closedAt).not.toBeNull() // pós-venda mantém data da venda
    st().moveDeal(id, 'triage')
    expect(st().data.deals[id].closedAt).toBeNull()
    expect(st().data.deals[id].lossReasonId).toBeNull()
  })

  it('moveDeal reordena a coluna (overId insere antes; sem overId vai pro fim)', () => {
    const triage = () =>
      Object.values(st().data.deals)
        .filter((d) => d.stageId === 'triage')
        .sort((a, b) => a.order - b.order)
    const first = triage()[0]
    const id = st().addDeal(input())
    expect(triage().at(-1)!.id).toBe(id)
    st().moveDeal(id, 'triage', first.id)
    expect(triage()[0].id).toBe(id)
    expect(triage().map((d) => d.order)).toEqual(triage().map((_, i) => i))
  })

  it('setField grava em custom[code] e gera field_changed string', () => {
    const id = st().addDeal(input())
    st().setField(id, 'brand', 'Delphi')
    expect(st().data.deals[id].custom['brand']).toBe('Delphi')
    expect(lastAct(id).params[0]).toMatchObject({ fieldId: 'brand', oldValue: 'Bosch', newValue: 'Delphi' })
  })

  it('logContactToday → contact_logged hoje; lastContactMsOf reflete', () => {
    const id = st().addDeal(input())
    useCrmStore.setState((s) => ({
      data: { ...s.data, deals: { ...s.data.deals, [id]: { ...s.data.deals[id], createdAt: Date.now() - 20 * msDay } } },
    }))
    const before = lastContactMsOf(st().data, id)
    st().logContactToday(id)
    expect(lastAct(id).type).toBe('contact_logged')
    expect(lastContactMsOf(st().data, id)).toBeGreaterThan(before)
    expect(Date.now() - lastContactMsOf(st().data, id)).toBeLessThan(5000)
  })

  it('createTask/completeTask → Task ligada + task_created/task_done', () => {
    const id = st().addDeal(input())
    const taskId = st().createTask({ dealId: id, text: 'cobrar cotação', kind: 'acompanhar', dueAt: Date.now() + msDay })
    expect(st().data.tasks[taskId]).toMatchObject({ dealId: id, completed: false })
    expect(lastAct(id).type).toBe('task_created')
    st().completeTask(taskId, 'cliente aprovou')
    expect(st().data.tasks[taskId]).toMatchObject({ completed: true, result: 'cliente aprovou' })
    expect(lastAct(id).type).toBe('task_done')
  })

  it('addNote / addTag / removeTag / setLoss geram Activities', () => {
    const id = st().addDeal(input())
    st().addNote(id, 'pediu 4 unidades')
    expect(lastAct(id)).toMatchObject({ type: 'note', text: 'pediu 4 unidades' })
    st().addTag(id, 'garantia')
    st().addTag(id, 'garantia')
    expect(st().data.deals[id].tags).toEqual(['garantia'])
    st().removeTag(id, 'garantia')
    expect(st().data.deals[id].tags).toEqual([])
    expect(lastAct(id).params[0]).toMatchObject({ fieldId: 'tag', oldValue: 'garantia', newValue: '' })
    st().setLoss(id, 'lr-1')
    expect(st().data.deals[id].lossReasonId).toBe('lr-1')
    expect(lastAct(id)).toMatchObject({ type: 'loss_applied' })
    expect(lastAct(id).params[0]).toMatchObject({ newValue: 'Preço' })
  })

  it('importDeals deduplica por Contact.phone normalizado', () => {
    const existingPhone = Object.values(st().data.contacts)[0].phone
    const contactsBefore = Object.keys(st().data.contacts).length
    const dealsBefore = Object.keys(st().data.deals).length
    const added = st().importDeals([
      { customerName: 'Já existe', phone: existingPhone },
      { customerName: 'Novo', phone: '81 96666-5555' },
    ])
    expect(added).toBe(1)
    expect(Object.keys(st().data.contacts)).toHaveLength(contactsBefore + 1)
    expect(Object.keys(st().data.deals)).toHaveLength(dealsBefore + 1)
    const fresh = Object.values(st().data.deals).find((d) => d.name === 'Novo')!
    expect(fresh.stageId).toBe('triage')
    expect(fresh.sourceId).toBe('src-2')
  })

  it('removeDeal apaga tarefas e atividades do deal', () => {
    const id = st().addDeal(input())
    st().createTask({ dealId: id, text: 'x', kind: 'acompanhar', dueAt: null })
    st().removeDeal(id)
    expect(st().data.deals[id]).toBeUndefined()
    expect(actsOf(id)).toHaveLength(0)
    expect(Object.values(st().data.tasks).some((t) => t.dealId === id)).toBe(false)
  })

  it('removeStage só remove etapa editável e vazia', () => {
    st().upsertStage({ id: 'tmp', pipelineId: 'pipe-main', name: 'Tmp', color: '#000', sort: 99, kind: 'open', editable: true, emoji: '•' })
    expect(st().data.stages['tmp']).toBeDefined()
    st().removeStage('triage') // tem deals
    expect(st().data.stages['triage']).toBeDefined()
    st().removeStage('tmp')
    expect(st().data.stages['tmp']).toBeUndefined()
  })
})

describe('persistMigrate', () => {
  it('estado v1 vira { data } v2 com 10 contatos e grava backup 1×', () => {
    const spy = vi.spyOn(localStorageMock, 'setItem')
    const v1 = { deals: SEED_DEALS_V1 }
    const out = persistMigrate(v1, 1)
    expect(out.data.version).toBe(2)
    expect(Object.keys(out.data.contacts)).toHaveLength(10)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('crm.deals.v1.backup', JSON.stringify(v1))
    persistMigrate(v1, 1) // backup já existe → não sobrescreve
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('preserva recência do v1 (lastContactAt vira contact_logged)', () => {
    const out = persistMigrate({ deals: SEED_DEALS_V1 }, 1)
    const v1 = SEED_DEALS_V1[0]
    expect(new Date(lastContactMsOf(out.data, v1.id)).toISOString().slice(0, 10)).toBe(v1.lastContactAt)
  })

  it('v1 vazio vira v2 sem deals; v2 passa adiante com coleções-padrão', () => {
    expect(Object.keys(persistMigrate({ deals: [] }, 1).data.deals)).toHaveLength(0)
    const data = seedCrmData()
    const partial = { ...data, sources: undefined } as unknown as typeof data
    const out = persistMigrate({ data: partial }, 2)
    expect(out.data.deals).toEqual(data.deals)
    expect(Object.keys(out.data.sources)).toHaveLength(4)
  })
})

describe('correções da revisão', () => {
  const triage = () =>
    Object.values(st().data.deals)
      .filter((d) => d.stageId === 'triage')
      .sort((a, b) => a.order - b.order)
      .map((d) => d.id)

  it('removeDeal apaga contato órfão → telefone pode ser importado de novo', () => {
    const id = st().addDeal(input({ phone: '81 95555-4444' }))
    const contactId = st().data.deals[id].contactId!
    st().removeDeal(id)
    expect(st().data.contacts[contactId]).toBeUndefined()
    expect(st().importDeals([{ customerName: 'Volta', phone: '81 95555-4444' }])).toBe(1)
  })

  it('removeDeal mantém contato ainda usado por outro deal', () => {
    const a = st().addDeal(input())
    const b = st().addDeal(input({ name: 'Segunda cotação' }))
    const contactId = st().data.deals[a].contactId!
    st().removeDeal(a)
    expect(st().data.contacts[contactId]).toBeDefined()
    expect(st().data.deals[b].contactId).toBe(contactId)
  })

  it('addDeal direto em etapa won seta closedAt', () => {
    const id = st().addDeal(input({ stageId: 'won' }))
    expect(st().data.deals[id].closedAt).not.toBeNull()
  })

  it('updateDeal de telefone em contato compartilhado desvincula só este deal', () => {
    const a = st().addDeal(input())
    const b = st().addDeal(input({ name: 'Segunda cotação' }))
    const shared = st().data.deals[a].contactId!
    st().updateDeal(a, { phone: '81 94444-3333' })
    expect(st().data.contacts[shared].phone).toBe('5581988887777')
    expect(st().data.deals[b].contactId).toBe(shared)
    const own = st().data.deals[a].contactId!
    expect(own).not.toBe(shared)
    expect(st().data.contacts[own].phone).toBe('5581944443333')
    expect(st().data.contacts[own].custom['profile']).toBe('mecanico')
  })

  it('updateDeal para telefone de contato existente religa a ele', () => {
    const a = st().addDeal(input())
    const other = st().addDeal(input({ name: 'Outro', phone: '81 93333-2222' }))
    st().updateDeal(a, { phone: '81 93333-2222' })
    expect(st().data.deals[a].contactId).toBe(st().data.deals[other].contactId)
  })

  it('addDeal com telefone existente não sobrescreve perfil já definido', () => {
    const a = st().addDeal(input({ contactCustom: { profile: 'revendedor' } }))
    st().addDeal(input({ name: 'Nova', contactCustom: { profile: 'bombista', extra: 'x' } }))
    const c = st().data.contacts[st().data.deals[a].contactId!]
    expect(c.custom['profile']).toBe('revendedor')
    expect(c.custom['extra']).toBe('x') // preenche só chaves vazias
  })

  it('moveDeal soltando o card sobre ele mesmo não muda a ordem', () => {
    const before = triage()
    st().moveDeal(before[0], 'triage', before[0])
    expect(triage()).toEqual(before)
  })

  it('moveDeal para baixo na mesma coluna insere depois do alvo', () => {
    st().addDeal(input({ name: 'x1', phone: '1' }))
    st().addDeal(input({ name: 'x2', phone: '2' }))
    const before = triage()
    st().moveDeal(before[0], 'triage', before[1])
    expect(triage().slice(0, 2)).toEqual([before[1], before[0]])
  })
})

describe('persistMigrate tolerante', () => {
  it('v1 com deal sem activityLog/phone ainda migra os deals', () => {
    const broken = SEED_DEALS_V1.map(({ activityLog: _a, ...rest }, i) =>
      i === 0 ? { ...rest, phone: undefined } : rest,
    )
    const out = persistMigrate({ deals: broken }, 1)
    expect(Object.keys(out.data.deals)).toHaveLength(SEED_DEALS_V1.length)
  })
})

describe('correções da 2ª/3ª revisão', () => {
  const ghostData = () => {
    const data = seedCrmData()
    const ghost = { ...data.deals['seed-1'], id: 'ghost', stageId: 'nope' }
    return {
      ...data,
      deals: { ...data.deals, ghost },
      tasks: { t1: { id: 't1', dealId: 'ghost', text: 'x', kind: 'acompanhar', dueAt: null, completed: false, createdAt: 0, updatedAt: 0 } },
      activities: { ...data.activities, g1: { id: 'g1', dealId: 'ghost', type: 'note' as const, text: 'x', params: [], authorName: 'me', createdAt: 0 } },
    }
  }

  it('religar por telefone sem mudar perfil preserva o perfil do contato alvo', () => {
    const a = st().addDeal(input({ contactCustom: { profile: 'mecanico' } }))
    const b = st().addDeal(input({ name: 'B', phone: '81 93333-2222', contactCustom: { profile: 'revendedor' } }))
    st().updateDeal(a, { phone: '81 93333-2222' }) // drawer só envia campos alterados
    const target = st().data.contacts[st().data.deals[b].contactId!]
    expect(st().data.deals[a].contactId).toBe(target.id)
    expect(target.custom['profile']).toBe('revendedor')
  })

  it('religar e escolher perfil explicitamente aplica no contato alvo', () => {
    const a = st().addDeal(input({ contactCustom: { profile: 'mecanico' } }))
    const b = st().addDeal(input({ name: 'B', phone: '81 93333-2222', contactCustom: { profile: 'revendedor' } }))
    st().updateDeal(a, { phone: '81 93333-2222', contactCustom: { profile: 'mecanico' } })
    expect(st().data.contacts[st().data.deals[b].contactId!].custom['profile']).toBe('mecanico')
  })

  it('perfil alterado de fato pelo usuário continua sendo aplicado', () => {
    const a = st().addDeal(input({ contactCustom: { profile: 'mecanico' } }))
    st().updateDeal(a, { contactCustom: { profile: 'bombista' } })
    expect(st().data.contacts[st().data.deals[a].contactId!].custom['profile']).toBe('bombista')
  })

  it('replaceAll repara deal com etapa inexistente (vai p/ 1ª etapa) e mantém tarefas/atividades', () => {
    st().replaceAll(ghostData())
    expect(st().data.deals['ghost'].stageId).toBe('triage')
    expect(st().data.tasks['t1']).toBeDefined()
    expect(st().data.activities['g1']).toBeDefined()
  })

  it('replaceAll descarta só o irreparável (não-objeto / id divergente / sem nome) e o que dependia dele', () => {
    const data = ghostData()
    st().replaceAll({
      ...data,
      deals: { ...data.deals, junk: 'x' as never, wrong: { ...seedCrmData().deals['seed-1'], id: 'other' }, ghost: { ...data.deals['ghost'], name: undefined as never } },
    })
    expect(st().data.deals['junk']).toBeUndefined()
    expect(st().data.deals['wrong']).toBeUndefined()
    expect(st().data.deals['ghost']).toBeUndefined()
    expect(st().data.tasks['t1']).toBeUndefined()
    expect(st().data.activities['g1']).toBeUndefined()
  })

  it('repara pipelineId inexistente, tags/custom ausentes e contactId pendente', () => {
    const data = seedCrmData()
    const d = data.deals['seed-1']
    st().replaceAll({
      ...data,
      deals: { ...data.deals, 'seed-1': { ...d, pipelineId: 'pipe-old', tags: undefined as never, custom: undefined as never, contactId: 'c-gone' } },
    })
    const fixed = st().data.deals['seed-1']
    expect(fixed.pipelineId).toBe('pipe-main')
    expect(fixed.tags).toEqual([])
    expect(fixed.custom).toEqual({})
    expect(fixed.contactId).toBeNull()
  })

  it('etapas/pipelines vazios no persistido caem p/ o seed em vez de apagar deals', () => {
    const data = seedCrmData()
    const out = persistMigrate({ data: { ...data, stages: {}, pipelines: {} } }, 2)
    expect(Object.keys(out.data.stages)).toHaveLength(7)
    expect(Object.keys(out.data.deals)).toHaveLength(10)
  })

  it('defaultPipelineId inexistente volta p/ o do seed', () => {
    const data = seedCrmData()
    const out = persistMigrate({ data: { ...data, settings: { ...data.settings, defaultPipelineId: 'gone' } } }, 2)
    expect(out.data.settings.defaultPipelineId).toBe('pipe-main')
  })
})

describe('persistMerge (hidratação v2 sem migrate)', () => {
  it('repara o estado v2 já salvo e ignora lixo', async () => {
    const { persistMerge } = await import('./useCrmStore')
    const data = seedCrmData()
    const broken = { ...data, deals: { ...data.deals, ghost: { ...data.deals['seed-1'], id: 'ghost', stageId: 'nope' } } }
    const current = { data: seedCrmData(), extra: 1 }
    const out = persistMerge({ data: broken }, current)
    expect(out.data.deals['ghost'].stageId).toBe('triage')
    expect(out.extra).toBe(1)
    expect(persistMerge(null, current)).toBe(current)
  })

  it('hidratação real do store passa pelo merge', async () => {
    const data = seedCrmData()
    const broken = { ...data, deals: { ...data.deals, ghost: { ...data.deals['seed-1'], id: 'ghost', stageId: 'nope' } } }
    localStorageMock.setItem('crm.deals.v1', JSON.stringify({ state: { data: broken }, version: 2 }))
    await useCrmStore.persist.rehydrate()
    expect(st().data.deals['ghost'].stageId).toBe('triage')
  })
})

describe('correções da 4ª revisão', () => {
  it('etapa apontando p/ pipeline inexistente não segura o deal: vai p/ 1ª etapa válida', () => {
    const data = seedCrmData()
    st().replaceAll({
      ...data,
      stages: { ...data.stages, orphan: { ...data.stages['quote'], id: 'orphan', pipelineId: 'pipe-gone' } },
      deals: { ...data.deals, 'seed-1': { ...data.deals['seed-1'], stageId: 'orphan' } },
    })
    expect(st().data.deals['seed-1'].stageId).toBe('triage')
    expect(st().data.deals['seed-1'].pipelineId).toBe('pipe-main')
  })

  it('nenhuma etapa com pipeline válido → chassi do seed', () => {
    const data = seedCrmData()
    const out = persistMigrate({ data: { ...data, pipelines: { other: { ...data.pipelines['pipe-main'], id: 'other' } } } }, 2)
    expect(out.data.pipelines['pipe-main']).toBeDefined()
    expect(out.data.deals['seed-1'].stageId).toBe(data.deals['seed-1'].stageId)
  })

  it('deal reparado sem createdAt usa o instante do saneamento, não 1970', () => {
    const data = seedCrmData()
    const before = Date.now()
    st().replaceAll({ ...data, deals: { ...data.deals, 'seed-1': { ...data.deals['seed-1'], createdAt: undefined as never } } })
    expect(st().data.deals['seed-1'].createdAt).toBeGreaterThanOrEqual(before)
  })
})

describe('correções da 5ª revisão', () => {
  const extraPipeline = () => {
    const data = seedCrmData()
    st().replaceAll({
      ...data,
      pipelines: { ...data.pipelines, 'pipe-2': { ...data.pipelines['pipe-main'], id: 'pipe-2', isMain: false } },
      stages: { ...data.stages, 'p2-a': { ...data.stages['triage'], id: 'p2-a', pipelineId: 'pipe-2' } },
    })
  }

  it('updateDeal com telefone em deal sem contato cria/religa contato', () => {
    const id = st().addDeal(input())
    useCrmStore.setState((s) => ({
      data: { ...s.data, deals: { ...s.data.deals, [id]: { ...s.data.deals[id], contactId: null } } },
    }))
    st().updateDeal(id, { phone: '81 92222-1111', contactCustom: { profile: 'bombista' } })
    const c = st().data.contacts[st().data.deals[id].contactId!]
    expect(c.phone).toBe('5581922221111')
    expect(c.custom['profile']).toBe('bombista')
    const other = st().addDeal(input({ name: 'Z', phone: '81 91111-0000' }))
    useCrmStore.setState((s) => ({
      data: { ...s.data, deals: { ...s.data.deals, [id]: { ...s.data.deals[id], contactId: null } } },
    }))
    st().updateDeal(id, { phone: '81 91111-0000' })
    expect(st().data.deals[id].contactId).toBe(st().data.deals[other].contactId)
  })

  it('moveDeal para etapa de outro pipeline alinha pipelineId', () => {
    extraPipeline()
    st().moveDeal('seed-1', 'p2-a')
    expect(st().data.deals['seed-1'].pipelineId).toBe('pipe-2')
  })

  it('addDeal usa o pipeline da etapa informada', () => {
    extraPipeline()
    const id = st().addDeal(input({ stageId: 'p2-a', pipelineId: 'pipe-main' }))
    expect(st().data.deals[id].pipelineId).toBe('pipe-2')
  })
})

describe('deal sem contato', () => {
  it('perfil escolhido sem telefone cria contato em vez de sumir', () => {
    const id = st().addDeal(input())
    useCrmStore.setState((s) => ({
      data: { ...s.data, deals: { ...s.data.deals, [id]: { ...s.data.deals[id], contactId: null } } },
    }))
    st().updateDeal(id, { phone: '', contactCustom: { profile: 'revendedor' } })
    const c = st().data.contacts[st().data.deals[id].contactId!]
    expect(c.custom['profile']).toBe('revendedor')
    expect(c.phone).toBe('')
  })
})

describe('pipeline padrão sem etapas', () => {
  it('defaultPipelineId sem etapas aponta p/ pipeline que tem etapas', () => {
    const data = seedCrmData()
    const out = persistMigrate({
      data: {
        ...data,
        pipelines: { ...data.pipelines, empty: { ...data.pipelines['pipe-main'], id: 'empty' } },
        settings: { ...data.settings, defaultPipelineId: 'empty' },
      },
    }, 2)
    expect(out.data.settings.defaultPipelineId).toBe('pipe-main')
  })

  it('importDeals sem etapa disponível devolve 0', () => {
    const data = seedCrmData()
    useCrmStore.setState({ data: { ...data, stages: {} } })
    expect(st().importDeals([{ customerName: 'N', phone: '81 90000-1234' }])).toBe(0)
  })
})

describe('backup antes de descartar formato desconhecido', () => {
  it('v1 em formato inesperado ainda grava backup antes de cair no seed', () => {
    const weird = { deals: { 'u-1': { id: 'u-1' } } }
    persistMigrate(weird, 1)
    expect(localStorageMock.getItem('crm.deals.v1.backup')).toBe(JSON.stringify(weird))
  })
})

describe('contatos corrompidos', () => {
  it('contato não-objeto é descartado e o deal fica sem contato; custom/phone ausentes são reparados', () => {
    const data = seedCrmData()
    const cid = data.deals['seed-1'].contactId!
    const cid2 = data.deals['seed-2'].contactId!
    st().replaceAll({
      ...data,
      contacts: { ...data.contacts, [cid]: 'junk' as never, [cid2]: { ...data.contacts[cid2], custom: undefined as never, phone: undefined as never } },
    })
    expect(st().data.contacts[cid]).toBeUndefined()
    expect(st().data.deals['seed-1'].contactId).toBeNull()
    expect(st().data.contacts[cid2].custom).toEqual({})
    expect(st().data.contacts[cid2].phone).toBe('')
  })
})

describe('atividades/tarefas corrompidas', () => {
  it('params/text/createdAt ausentes são reparados; tarefa sem texto ganha texto vazio', () => {
    const data = seedCrmData()
    st().replaceAll({
      ...data,
      activities: { a1: { id: 'a1', dealId: 'seed-1', type: 'field_changed', params: undefined as never, text: undefined as never, authorName: 'me', createdAt: undefined as never } },
      tasks: { t1: { id: 't1', dealId: 'seed-1', text: undefined as never, kind: 'acompanhar', dueAt: 'x' as never, completed: 'no' as never, createdAt: 0, updatedAt: 0 } },
    })
    const a = st().data.activities['a1']
    expect(a.params).toEqual([])
    expect(a.text).toBe('')
    expect(typeof a.createdAt).toBe('number')
    const t = st().data.tasks['t1']
    expect(t.text).toBe('')
    expect(t.dueAt).toBeNull()
    expect(t.completed).toBe(false)
  })
})

describe('configuração corrompida', () => {
  it('coleções de config com tipo errado ou itens inválidos voltam/filtram p/ formato válido', () => {
    const data = seedCrmData()
    const out = persistMigrate({
      data: {
        ...data,
        customFields: 'x' as never,
        sources: { ...data.sources, bad: null as never },
        lossReasons: [] as never,
        automations: {} as never,
      },
    }, 2)
    expect(out.data.customFields).toEqual(data.customFields)
    expect(out.data.sources['bad']).toBeUndefined()
    expect(Object.keys(out.data.lossReasons)).toHaveLength(3)
    expect(Array.isArray(out.data.automations)).toBe(true)
  })
})

describe('campo customizado com enums corrompidos', () => {
  it('enums não-array ou com itens inválidos são filtrados', () => {
    const data = seedCrmData()
    const out = persistMigrate({
      data: { ...data, customFields: { ...data.customFields, 'cf-brand': { ...data.customFields['cf-brand'], enums: [null, { id: 'e', value: 'X', sort: 0 }] as never }, 'cf-profile': { ...data.customFields['cf-profile'], enums: 'x' as never } } },
    }, 2)
    expect(out.data.customFields['cf-brand'].enums).toEqual([{ id: 'e', value: 'X', sort: 0 }])
    expect(out.data.customFields['cf-profile'].enums).toEqual([])
  })
})

describe('chassi com itens corrompidos', () => {
  it('etapas/pipelines null são removidos e etapa incompleta é reparada', () => {
    const data = seedCrmData()
    const out = persistMigrate({
      data: {
        ...data,
        pipelines: { ...data.pipelines, junk: null as never },
        stages: { ...data.stages, junk: null as never, quote: { ...data.stages['quote'], name: undefined as never, sort: 'x' as never, kind: 'weird' as never } },
      },
    }, 2)
    expect(out.data.stages['junk']).toBeUndefined()
    expect(out.data.pipelines['junk']).toBeUndefined()
    expect(out.data.stages['quote']).toMatchObject({ name: 'Sem nome', kind: 'open' })
    expect(typeof out.data.stages['quote'].sort).toBe('number')
    expect(out.data.deals['seed-2'].stageId).toBe(data.deals['seed-2'].stageId)
  })
})

describe('índices derivados (desempenho)', () => {
  // referência ingênua: varredura completa, como era antes do índice
  const bruteLastContact = (dealId: string) => {
    const data = st().data
    const ms = Object.values(data.activities)
      .filter((a) => a.dealId === dealId && a.type === 'contact_logged')
      .map((a) => a.createdAt)
    return ms.length ? Math.max(...ms) : (data.deals[dealId]?.createdAt ?? 0)
  }

  it('lastContactMsOf bate com a varredura completa após escritas, remoção e replaceAll', () => {
    const a = st().addDeal(input())
    const b = st().addDeal(input({ name: 'B', phone: '81 90000-0001' }))
    st().logContactToday(a)
    st().addNote(b, 'x')
    st().logContactToday(b)
    st().removeDeal(b)
    for (const id of Object.keys(st().data.deals)) expect(lastContactMsOf(st().data, id)).toBe(bruteLastContact(id))
    st().replaceAll(seedCrmData())
    for (const id of Object.keys(st().data.deals)) expect(lastContactMsOf(st().data, id)).toBe(bruteLastContact(id))
  })

  it('escritas não reconstroem o índice (derivação incremental) e leituras usam cache', async () => {
    const { activityIndexBuildCount } = await import('../domain/indexes')
    const id = st().addDeal(input())
    lastContactMsOf(st().data, id) // garante índice do estado atual
    const builds = activityIndexBuildCount()
    for (let i = 0; i < 20; i++) st().addNote(id, `n${i}`)
    st().logContactToday(id)
    for (const dealId of Object.keys(st().data.deals)) lastContactMsOf(st().data, dealId)
    expect(activityIndexBuildCount()).toBe(builds)
    expect(lastContactMsOf(st().data, id)).toBe(bruteLastContact(id))
  })

  it('teto de 500 por deal: corta as mais antigas, preserva deal_created e mantém índice coerente', async () => {
    const { activityIndex } = await import('../domain/indexes')
    const id = st().addDeal(input())
    useCrmStore.setState((s) => ({
      data: { ...s.data, deals: { ...s.data.deals, [id]: { ...s.data.deals[id], createdAt: Date.now() - 40 * msDay } } },
    }))
    st().logContactToday(id) // vai ser cortado (mais antigo depois do deal_created)
    // atividades com createdAt crescente p/ ordem determinística
    const base = Date.now()
    useCrmStore.setState((s) => {
      const acts = Object.fromEntries(
        Object.entries(s.data.activities).map(([k, a]) =>
          a.dealId === id && a.type === 'contact_logged' ? [k, { ...a, createdAt: base - 30 * msDay }] : [k, a],
        ),
      )
      return { data: { ...s.data, activities: acts } }
    })
    for (let i = 0; i < 505; i++) st().addNote(id, `n${i}`)
    const own = Object.values(st().data.activities).filter((a) => a.dealId === id)
    expect(own).toHaveLength(500)
    expect(own.some((a) => a.type === 'deal_created')).toBe(true)
    expect(own.some((a) => a.type === 'contact_logged')).toBe(false)
    expect(activityIndex(st().data.activities).count.get(id)).toBe(500)
    expect(lastContactMsOf(st().data, id)).toBe(bruteLastContact(id))
  })

  it('openTaskCountOf conta tarefas abertas por deal e acompanha create/complete', async () => {
    const { openTaskCountOf } = await import('../domain/indexes')
    const id = st().addDeal(input())
    expect(openTaskCountOf(st().data, id)).toBe(0)
    const t1 = st().createTask({ dealId: id, text: 'a', kind: 'acompanhar', dueAt: null })
    st().createTask({ dealId: id, text: 'b', kind: 'acompanhar', dueAt: null })
    expect(openTaskCountOf(st().data, id)).toBe(2)
    st().completeTask(t1)
    expect(openTaskCountOf(st().data, id)).toBe(1)
  })
})

describe('persist com gravação agrupada', () => {
  it('ações em rajada não gravam na hora; flush grava uma vez o estado final', () => {
    const spy = vi.spyOn(localStorageMock, 'setItem')
    const id = st().addDeal(input())
    for (let i = 0; i < 10; i++) st().addNote(id, `n${i}`)
    expect(spy).not.toHaveBeenCalled()
    expect(localStorageMock.getItem('crm.deals.v1')).toBeNull()
    crmStorage.flush()
    expect(spy).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(localStorageMock.getItem('crm.deals.v1')!)
    expect(saved.version).toBe(2)
    expect(Object.values(saved.state.data.activities).filter((a) => (a as { dealId: string }).dealId === id)).toHaveLength(11)
    spy.mockRestore()
  })

  it('grava sozinho ao fim da janela (sem flush manual)', () => {
    vi.useFakeTimers()
    try {
      st().addDeal(input())
      expect(localStorageMock.getItem('crm.deals.v1')).toBeNull()
      vi.advanceTimersByTime(500)
      expect(localStorageMock.getItem('crm.deals.v1')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
