export const STAGES = [
  { id: 'triage', label: 'Triagem / Novo Contato', emoji: '📥', accent: '#94a3b8' },
  { id: 'quote', label: 'Cotação Enviada', emoji: '📋', accent: '#38bdf8' },
  { id: 'waiting', label: 'Aguardando Resposta', emoji: '⏳', accent: '#fbbf24' },
  { id: 'negotiation', label: 'Em Negociação', emoji: '🤝', accent: '#fb923c' },
  { id: 'won', label: 'Venda Concluída', emoji: '✅', accent: '#4ade80' },
  { id: 'postsale', label: 'Pós-Venda & Rastreio', emoji: '🚚', accent: '#2dd4bf' },
  { id: 'warranty', label: 'Garantia / Análise Técnica', emoji: '🛡️', accent: '#a78bfa' },
] as const

export type StageId = (typeof STAGES)[number]['id']

export type StageMeta = (typeof STAGES)[number]

export const stageMeta = (id: StageId) => STAGES.find((s) => s.id === id)!

export const PROFILES = ['bombista', 'mecanico', 'revendedor', 'cliente_final'] as const
export type Profile = (typeof PROFILES)[number]

export const PROFILE_LABEL: Record<Profile, string> = {
  bombista: 'Bombista',
  mecanico: 'Mecânico',
  revendedor: 'Revendedor',
  cliente_final: 'Cliente Final',
}

export const PROFILE_CLASS: Record<Profile, string> = {
  bombista: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  mecanico: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  revendedor: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  cliente_final: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
}

export const BRANDS = ['Bosch', 'Delphi', 'Denso', 'Continental', 'Outra'] as const
export type Brand = (typeof BRANDS)[number]

export type ActivityType = 'created' | 'contact' | 'stage' | 'note'

export interface Activity {
  at: string
  type: ActivityType
  text: string
}

export interface Deal {
  id: string
  stage: StageId
  order: number
  customerName: string
  phone: string
  profile: Profile
  partCode: string
  application: string
  brand: Brand
  /** centavos (inteiro) — evita erro de ponto flutuante em dinheiro */
  valueBRL: number
  /** yyyy-MM-dd */
  lastContactAt: string
  closedAt: string | null
  notes: string
  activityLog: Activity[]
  createdAt: string
  updatedAt: string
}

export type DealInput = Omit<
  Deal,
  'id' | 'order' | 'activityLog' | 'createdAt' | 'updatedAt' | 'closedAt'
> & { closedAt?: string | null }
