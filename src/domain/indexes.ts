import type { Activity, CrmData } from './types'

// Índices derivados por deal, com cache por IDENTIDADE da coleção (WeakMap).
// Invariante: o store nunca muta `activities`/`tasks` in place — toda escrita cria
// um objeto novo — então a referência da coleção identifica o conteúdo.
// Coleções antigas saem do cache sozinhas quando o estado deixa de referenciá-las.

export interface ActivityIndex {
  count: Map<string, number> // atividades por deal (teto de 500)
  lastContact: Map<string, number> // createdAt do último contact_logged por deal
}

const activityCache = new WeakMap<CrmData['activities'], ActivityIndex>()
let activityBuilds = 0

/** Quantas vezes o índice foi construído do zero (varredura completa) — p/ teste. */
export const activityIndexBuildCount = () => activityBuilds

const addToIndex = (idx: ActivityIndex, a: Activity) => {
  idx.count.set(a.dealId, (idx.count.get(a.dealId) ?? 0) + 1)
  if (a.type === 'contact_logged' && a.createdAt > (idx.lastContact.get(a.dealId) ?? -Infinity)) {
    idx.lastContact.set(a.dealId, a.createdAt)
  }
}

/** Índice da coleção: O(1) se em cache; senão uma única varredura O(A). */
export function activityIndex(activities: CrmData['activities']): ActivityIndex {
  let idx = activityCache.get(activities)
  if (!idx) {
    activityBuilds++
    idx = { count: new Map(), lastContact: new Map() }
    for (const a of Object.values(activities)) addToIndex(idx, a)
    activityCache.set(activities, idx)
  }
  return idx
}

/** Novo índice = anterior + atividades adicionadas (O(deals), sem varrer atividades). */
export function extendActivityIndex(prev: ActivityIndex, added: Activity[]): ActivityIndex {
  const idx: ActivityIndex = { count: new Map(prev.count), lastContact: new Map(prev.lastContact) }
  for (const a of added) addToIndex(idx, a)
  return idx
}

/** Recalcula as entradas de um deal a partir das atividades que restaram dele. */
export function resetDealInIndex(idx: ActivityIndex, dealId: string, own: Activity[]) {
  idx.count.set(dealId, own.length)
  const contacts = own.filter((a) => a.type === 'contact_logged').map((a) => a.createdAt)
  if (contacts.length) idx.lastContact.set(dealId, Math.max(...contacts))
  else idx.lastContact.delete(dealId)
}

/** Registra o índice já derivado para uma coleção nova (evita a reconstrução). */
export function rememberActivityIndex(activities: CrmData['activities'], idx: ActivityIndex) {
  activityCache.set(activities, idx)
}

// ---------- tarefas abertas por deal ----------
const openTaskCache = new WeakMap<CrmData['tasks'], Map<string, number>>()

/** Nº de tarefas abertas do deal; uma varredura O(T) por versão da coleção de tarefas. */
export function openTaskCountOf(data: CrmData, dealId: string): number {
  let counts = openTaskCache.get(data.tasks)
  if (!counts) {
    counts = new Map()
    for (const t of Object.values(data.tasks)) {
      if (t.dealId && !t.completed) counts.set(t.dealId, (counts.get(t.dealId) ?? 0) + 1)
    }
    openTaskCache.set(data.tasks, counts)
  }
  return counts.get(dealId) ?? 0
}
