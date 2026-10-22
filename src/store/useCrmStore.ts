import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Deal, DealInput, StageId } from '../domain/types'
import { stageMeta } from '../domain/types'
import { todayISO } from '../domain/format'
import { SEED_DEALS } from './seed'

interface CrmState {
  deals: Deal[]
  addDeal: (input: DealInput) => string
  updateDeal: (id: string, patch: Partial<DealInput>) => void
  removeDeal: (id: string) => void
  logContactToday: (id: string) => void
  moveDeal: (id: string, toStage: StageId, overId?: string) => void
  importDeals: (items: { customerName: string; phone: string }[]) => number
  replaceAll: (deals: Deal[]) => void
  resetSeed: () => void
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`

const reindex = (deals: Deal[]): Deal[] => {
  const counters: Partial<Record<StageId, number>> = {}
  return deals.map((d) => {
    counters[d.stage] = (counters[d.stage] ?? 0) + 1
    return { ...d, order: counters[d.stage]! - 1 }
  })
}

export const useCrmStore = create<CrmState>()(
  persist(
    (set, get) => ({
      deals: SEED_DEALS,

      addDeal: (input) => {
        const id = uid()
        const now = new Date().toISOString()
        set((s) => ({
          deals: reindex([
            ...s.deals,
            {
              ...input,
              id,
              closedAt: input.stage === 'won' ? todayISO() : null,
              order: 0,
              activityLog: [{ at: now, type: 'created', text: 'Negociação criada' }],
              createdAt: now,
              updatedAt: now,
            },
          ]),
        }))
        return id
      },

      updateDeal: (id, patch) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d,
          ),
        })),

      removeDeal: (id) => set((s) => ({ deals: s.deals.filter((d) => d.id !== id) })),

      logContactToday: (id) =>
        set((s) => ({
          deals: s.deals.map((d) =>
            d.id === id
              ? {
                  ...d,
                  lastContactAt: todayISO(),
                  updatedAt: new Date().toISOString(),
                  activityLog: [
                    ...d.activityLog,
                    { at: new Date().toISOString(), type: 'contact', text: 'Contato registrado hoje (1 clique)' },
                  ],
                }
              : d,
          ),
        })),

      moveDeal: (id, toStage, overId) =>
        set((s) => {
          const deals = [...s.deals]
          const from = deals.findIndex((d) => d.id === id)
          if (from < 0) return s
          const deal = { ...deals[from] }
          deals.splice(from, 1)

          const changedStage = deal.stage !== toStage
          deal.stage = toStage
          const now = new Date().toISOString()
          const preSale: StageId[] = ['triage', 'quote', 'waiting', 'negotiation']
          if (toStage === 'won' && !deal.closedAt) deal.closedAt = todayISO()
          if (changedStage) {
            if (preSale.includes(toStage)) deal.closedAt = null
            deal.activityLog = [
              ...deal.activityLog,
              { at: now, type: 'stage', text: `Movido para "${stageMeta(toStage).label}"` },
            ]
          }

          let insertAt = deals.length
          if (overId) {
            const j = deals.findIndex((d) => d.id === overId)
            if (j >= 0) insertAt = j
          } else {
            for (let j = deals.length - 1; j >= 0; j--) {
              if (deals[j].stage === toStage) {
                insertAt = j + 1
                break
              }
            }
          }
          deal.updatedAt = now
          deals.splice(insertAt, 0, deal)
          return { deals: reindex(deals) }
        }),

      importDeals: (items) => {
        const existing = new Set(
          get()
            .deals.filter((d) => d.phone.replace(/\D/g, ''))
            .map((d) => d.phone.replace(/\D/g, '')),
        )
        const now = new Date().toISOString()
        let added = 0
        set((s) => {
          const fresh: Deal[] = []
          for (const it of items) {
            const digits = it.phone.replace(/\D/g, '')
            if (!digits || existing.has(digits)) continue
            existing.add(digits)
            added++
            fresh.push({
              id: uid(),
              stage: 'triage',
              order: 0,
              customerName: it.customerName || 'Sem nome',
              phone: digits,
              profile: 'cliente_final',
              partCode: '',
              application: '',
              brand: 'Outra',
              valueBRL: 0,
              lastContactAt: todayISO(),
              closedAt: null,
              notes: 'Importado da agenda de contatos.',
              activityLog: [{ at: now, type: 'created', text: 'Importado de vCard/CSV' }],
              createdAt: now,
              updatedAt: now,
            })
          }
          return { deals: reindex([...s.deals, ...fresh]) }
        })
        return added
      },

      replaceAll: (deals) => set({ deals: reindex(deals) }),
      resetSeed: () => set({ deals: SEED_DEALS }),
    }),
    {
      name: 'crm.deals.v1',
      version: 1,
    },
  ),
)
