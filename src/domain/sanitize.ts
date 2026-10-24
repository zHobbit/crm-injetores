import type { Activity, Contact, CrmData, Deal, Task } from './types'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const nonEmptyRecord = (v: unknown): v is Record<string, unknown> => isRecord(v) && Object.keys(v).length > 0

/** true se o esqueleto mínimo do v2 está presente (etapas e deals). */
export const hasV2Skeleton = (data: Partial<CrmData>): boolean =>
  nonEmptyRecord(data.stages) && isRecord(data.deals)

const USER_DATA_EMPTY: Pick<CrmData, 'contacts' | 'companies' | 'deals' | 'tasks' | 'activities' | 'catalogElements'> = {
  contacts: {},
  companies: {},
  deals: {},
  tasks: {},
  activities: {},
  catalogElements: {},
}

/**
 * Mescla CrmData parcial sobre o seed. Configuração ausente vem do seed; dados do
 * usuário ausentes viram coleção vazia (nunca injeta os negócios de demonstração). O chassi
 * (pipelines/stages/settings) também vem do seed quando chega vazio ou inconsistente
 * — sem etapas o saneamento não teria onde pôr os deals.
 */
export function mergeWithSeed(data: Partial<CrmData>, seed: CrmData): CrmData {
  const out = { ...seed, ...USER_DATA_EMPTY } as Record<keyof CrmData, unknown>
  for (const k of Object.keys(seed) as (keyof CrmData)[]) {
    if (data[k] !== undefined && data[k] !== null) out[k] = data[k]
  }
  const merged = { ...(out as unknown as CrmData), version: 2 as const }
  // config: coleção com tipo errado volta ao seed; itens não-objeto são removidos
  for (const k of ['pipelines', 'stages', 'customFields', 'sources', 'lossReasons', 'catalogs'] as const) {
    const col = merged[k] as unknown
    merged[k] = (isRecord(col)
      ? Object.fromEntries(Object.entries(col).filter(([id, v]) => isRecord(v) && v.id === id))
      : seed[k]) as never
  }
  merged.stages = Object.fromEntries(
    Object.entries(merged.stages).map(([id, st], i) => [
      id,
      {
        ...st,
        name: typeof st.name === 'string' ? st.name : 'Sem nome',
        color: typeof st.color === 'string' ? st.color : '#94a3b8',
        emoji: typeof st.emoji === 'string' ? st.emoji : '',
        sort: typeof st.sort === 'number' && Number.isFinite(st.sort) ? st.sort : 1000 + i,
        kind: st.kind === 'won' || st.kind === 'lost' ? st.kind : 'open',
        editable: st.editable !== false,
      },
    ]),
  )
  merged.customFields = Object.fromEntries(
    Object.entries(merged.customFields).map(([id, f]) => [
      id,
      {
        ...f,
        enums: Array.isArray(f.enums) ? f.enums.filter((e) => isRecord(e) && typeof e.value === 'string') : [],
        scopes: Array.isArray(f.scopes) ? f.scopes : [],
        requiredInStageIds: Array.isArray(f.requiredInStageIds) ? f.requiredInStageIds : [],
      },
    ]),
  )
  for (const k of ['contacts', 'companies', 'deals', 'tasks', 'activities', 'catalogElements'] as const) {
    if (!isRecord(merged[k])) merged[k] = {} as never
  }
  merged.automations = Array.isArray(merged.automations)
    ? merged.automations.filter((r) => isRecord(r) && typeof r.id === 'string')
    : seed.automations
  const pipelines = merged.pipelines
  const usableStage = nonEmptyRecord(pipelines) && nonEmptyRecord(merged.stages)
    ? Object.values(merged.stages).some((st) => isRecord(st) && st.pipelineId in pipelines)
    : false
  if (!usableStage) {
    merged.pipelines = seed.pipelines
    merged.stages = seed.stages
  }
  // pipeline padrão precisa existir E ter etapas, senão o quadro abre sem colunas
  const hasStages = (pid: unknown) =>
    Object.values(merged.stages).some((st) => isRecord(st) && st.pipelineId === pid)
  merged.settings = { ...seed.settings, ...(isRecord(merged.settings) ? merged.settings : {}) }
  if (!(merged.settings.defaultPipelineId in merged.pipelines) || !hasStages(merged.settings.defaultPipelineId)) {
    merged.settings.defaultPipelineId = Object.keys(merged.pipelines).find(hasStages)!
  }
  return merged
}

/**
 * Saneamento único do CrmData v2 (estado persistido, replaceAll/restauração).
 * REPARA em vez de descartar — o resultado é re-persistido e não há backup v2:
 *   - etapa inexistente → 1ª etapa do pipeline do deal (ou do padrão)
 *   - pipelineId inexistente/divergente → pipeline da etapa
 *   - tags/custom ausentes → vazios; contactId pendente → null; valores inválidos → 0
 *     (datas inválidas → `now`, p/ não exibir recência de 1970)
 *   - contato: não-objeto/id divergente é descartado; nome/telefone/custom ausentes reparados
 *   - tarefa/atividade: campos ausentes reparados; órfãs (deal descartado) removidas
 * Só descarta o irreparável (não-objeto, id divergente da chave, sem nome) e as
 * tarefas/atividades que apontavam para ele. Exige chassi válido (use mergeWithSeed antes).
 */
export function sanitizeCrmData(data: CrmData, now = Date.now()): CrmData {
  // etapa só serve se é objeto e pertence a um pipeline existente
  const stageOk = (id: unknown): id is string =>
    typeof id === 'string' && isRecord(data.stages[id]) && data.stages[id].pipelineId in data.pipelines
  const firstStageOf = (pipelineId: string) =>
    Object.values(data.stages)
      .filter((s) => s.pipelineId === pipelineId && stageOk(s.id))
      .sort((a, b) => a.sort - b.sort)[0]?.id
  const fallbackStage =
    firstStageOf(data.settings.defaultPipelineId) ?? Object.keys(data.stages).find((id) => stageOk(id))!
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

  const contacts: CrmData['contacts'] = {}
  for (const [key, raw] of Object.entries(data.contacts)) {
    if (!isRecord(raw) || raw.id !== key) continue
    const c = raw as unknown as Contact
    contacts[key] = {
      ...c,
      name: typeof c.name === 'string' ? c.name : 'Sem nome',
      phone: typeof c.phone === 'string' ? c.phone : '',
      custom: isRecord(c.custom) ? c.custom : {},
      createdAt: num(c.createdAt, now),
      updatedAt: num(c.updatedAt, num(c.createdAt, now)),
    }
  }

  const deals: CrmData['deals'] = {}
  for (const [key, raw] of Object.entries(data.deals)) {
    if (!isRecord(raw) || raw.id !== key || typeof raw.name !== 'string') continue
    const d = raw as unknown as Deal
    const stageId = stageOk(d.stageId)
        ? d.stageId
        : ((typeof d.pipelineId === 'string' ? firstStageOf(d.pipelineId) : undefined) ?? fallbackStage)
    deals[key] = {
      ...d,
      stageId,
      pipelineId: data.stages[stageId].pipelineId,
      contactId: typeof d.contactId === 'string' && d.contactId in contacts ? d.contactId : null,
      custom: isRecord(d.custom) ? d.custom : {},
      tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === 'string') : [],
      order: num(d.order, 0),
      priceCents: num(d.priceCents, 0),
      createdAt: num(d.createdAt, now),
      updatedAt: num(d.updatedAt, num(d.createdAt, now)),
    }
  }
  const tasks: CrmData['tasks'] = {}
  for (const [key, raw] of Object.entries(data.tasks)) {
    if (!isRecord(raw) || raw.id !== key || !(raw.dealId === null || (raw.dealId as string) in deals)) continue
    const t = raw as unknown as Task
    tasks[key] = {
      ...t,
      text: typeof t.text === 'string' ? t.text : '',
      kind: typeof t.kind === 'string' ? t.kind : 'acompanhar',
      dueAt: typeof t.dueAt === 'number' && Number.isFinite(t.dueAt) ? t.dueAt : null,
      completed: t.completed === true,
      createdAt: num(t.createdAt, now),
      updatedAt: num(t.updatedAt, num(t.createdAt, now)),
    }
  }
  const activities: CrmData['activities'] = {}
  for (const [key, raw] of Object.entries(data.activities)) {
    if (!isRecord(raw) || raw.id !== key || !((raw.dealId as string) in deals)) continue
    const a = raw as unknown as Activity
    activities[key] = {
      ...a,
      text: typeof a.text === 'string' ? a.text : '',
      params: Array.isArray(a.params) ? a.params.filter(isRecord) as unknown as Activity['params'] : [],
      authorName: typeof a.authorName === 'string' ? a.authorName : 'me',
      createdAt: num(a.createdAt, now),
    }
  }
  return { ...data, contacts, deals, tasks, activities }
}
