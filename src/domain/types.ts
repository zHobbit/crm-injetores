// Schema v2 do CRM — modelo normalizado, 1 usuário / dado local.
// Decisões de modelagem:
//   - Deal.custom indexado por CustomField.code (não por id)
//   - Deal.unsorted obrigatório (default false)
//   - Stage.emoji (extensão local: preserva os emojis do seed atual)
//   - Contact.custom (perfil vive em custom['profile'], campo scope contact)
// 1 usuário: createdBy/updatedBy = 'me'; authorName = 'me'.

// ---------- tipos primitivos de metadado ----------
export type FieldKind =
  | 'text' | 'textarea' | 'number' | 'money' // money: cents inteiro (format.ts já faz BRL)
  | 'date' | 'select' | 'checkbox' | 'catalog' // catalog = valor é linha de catálogo (N:N)
// enum legível de tipos de campo

export type EntityScope = 'deal' | 'contact' | 'company' | 'catalog_element'
// Em quais entidades um campo aparece.
// Um bool por entidade vira lista de escopos.

// ---------- Pipeline / Stage ----------
export interface Pipeline {
  id: string // string/uuid p/ localStorage sem colisão
  name: string
  isMain: boolean // pipeline "padrão"
  isArchive: boolean // arquivado
  unsortedEnabled: boolean // raia de leads ainda não ordenados
  sort: number
}
export interface Stage {
  id: string
  pipelineId: string
  name: string
  color: string
  sort: number
  type: number // 1=normal, 2=ganho, 3=perda
  editable: boolean
  emoji: string // preserva os emojis do seed atual
}

/** Semântica de Stage.type: 1=normal, 2=ganho, 3=perda (rótulos pt-BR). */
export function stageTypeMeta(t: number): { kind: 'normal' | 'won' | 'loss'; label: string } {
  const meta: Record<number, { kind: 'normal' | 'won' | 'loss'; label: string }> = {
    1: { kind: 'normal', label: 'Normal' },
    2: { kind: 'won', label: 'Ganho' },
    3: { kind: 'loss', label: 'Perda' },
  }
  return meta[t] ?? meta[1]
}

// ---------- CustomField (metadado rico) ----------
export interface CustomField {
  id: string
  code: string // slug estável p/ migrar campos fixos atuais (índice de Deal.custom)
  name: string
  kind: FieldKind
  scopes: EntityScope[] // em quais entidades aparece
  sort: number
  multiple: boolean
  required: boolean
  visible: boolean
  filterable: boolean
  sortable: boolean
  predefined: boolean // campo do sistema, não deletável
  enums: FieldEnum[] // p/ select; ordenar por sort
  valuesTree?: { id: string; parentId: string | null; value: string }[] // listas encadeadas; só se precisar cascata
  help?: string
}
export interface FieldEnum { id: string; value: string; sort: number }

// ---------- Catalog / CatalogElement ----------
export interface Catalog {
  id: string
  name: string
  canLinkMultiple: boolean // habilita N:N com o deal (peças por cotação)
  showInCards: boolean
}
export interface CatalogElement {
  id: string
  catalogId: string
  name: string // ex.: "Injetor Bosch 0445110376"
  values: Record<string, string | number | string[]> // chave = CustomField.id
}

// ---------- Contact / Company (entidades separadas do deal) ----------
export interface Contact {
  id: string
  name: string
  phone: string // normalizado 55DDNNUUUUUUU (format.ts normalizePhone)
  email?: string
  createdAt: number // ms epoch
  updatedAt: number // ms epoch
  /** valores dos CustomField scope contact — chave = CustomField.code (ex.: 'profile') */
  custom: Record<string, string | number | string[] | null>
}
export interface Company {
  id: string
  name: string
}

// ---------- Deal / Lead ----------
export interface Deal {
  id: string
  pipelineId: string
  stageId: string // era `stage` hardcoded em STAGES
  unsorted: boolean // está na raia "não ordenado" (default false)
  name: string // era só customerName embutido
  contactId: string | null // pessoa separada (Contact)
  companyId: string | null
  order: number // posição no kanban
  priceCents: number // cents inteiro (evita float)
  sourceId: string | null // origem do lead (WhatsApp, agenda, indicação)
  lossReasonId: string | null
  currency: 'BRL' // fixo local
  closedAt: number | null // ms epoch
  custom: Record<string, string | number | string[] | null> // chave = CustomField.code
  tags: string[]
  createdAt: number // ms epoch
  updatedAt: number // ms epoch
  createdBy: string // 'me' — 1 usuário, mantido p/ trilha
  updatedBy: string // 'me'
}

// ---------- Task (entidade) ----------
export interface Task {
  id: string
  dealId: string | null
  text: string
  kind: string // ex.: 'followup','cotacao','posvenda','garantia'
  dueAt: number | null // ms epoch
  completed: boolean
  createdAt: number // ms epoch
  updatedAt: number // ms epoch
}

// ---------- Activity / Event (feed com diff de campo) ----------
export type ActivityType =
  | 'deal_created' | 'stage_changed' | 'field_changed' | 'note'
  | 'contact_logged' | 'task_created' | 'task_done' | 'tag_changed' | 'loss_applied'

export interface FieldDiffParam {
  fieldId: string
  kind: FieldKind
  oldValue: string | number | null
  newValue: string | number | null
  oldEnumId?: string | null
  newEnumId?: string | null
}

export interface Activity {
  id: string
  dealId: string
  type: ActivityType
  text: string
  params: FieldDiffParam[] // 0..n diffs — o activityLog passivo v1 não tinha
  authorName: string // 'me'
  createdAt: number // ms epoch
}

// ---------- LossReason / Source / Settings ----------
export interface LossReason { id: string; name: string; sort: number }
export interface Source { id: string; name: string; color?: string; sort: number }
export interface AccountSettings {
  currency: 'BRL'
  timezone: string // p/ delay de automação
  defaultPipelineId: string
}

// ---------- Store normalizado ----------
export interface CrmData {
  version: 2
  pipelines: Record<string, Pipeline>
  stages: Record<string, Stage>
  customFields: Record<string, CustomField>
  catalogs: Record<string, Catalog>
  catalogElements: Record<string, CatalogElement>
  contacts: Record<string, Contact>
  companies: Record<string, Company>
  deals: Record<string, Deal>
  tasks: Record<string, Task>
  activities: Record<string, Activity> // coleção separada, com teto por deal
  lossReasons: Record<string, LossReason>
  sources: Record<string, Source>
  settings: AccountSettings
  automations: AutomationRule[]
}

// ---------- Motor de automação declarativo ----------
export interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  dealPipelineId: string | 'any'
  trigger: TriggerEvent
  conditions: { logic: 'and' | 'or'; items: Condition[] }
  actions: Action[]
  delay?: number // segundos; declarativo — engine local executa síncrono
  cooldown?: 300 | 600 | 86400 // cooldowns suportados (s)
  canInterrupt?: boolean
  workWindow?: { days: number[]; from: string; to: string } | null
  lastFiredAt?: Record<string, number> // por dealId: base p/ cooldown
}

export type TriggerEvent =
  | { kind: 'deal_created' }
  | { kind: 'stage_changed'; toStageId?: string }
  | { kind: 'tag_changed'; action: 'added' | 'removed' }
  | { kind: 'field_changed'; fieldCode: string }
  | { kind: 'days_no_contact'; days: number } // roda no tick diário
  | { kind: 'task_overdue' }

export type Condition =
  | { field: 'stage'; op: 'in'; value: string[] }
  | { field: 'source'; op: 'in'; value: string[] }
  | { field: 'profile'; op: 'is' | 'is_not'; value: string }
  | { field: 'price'; op: 'gt' | 'lt' | 'between'; value: number }
  | { field: 'custom'; fieldCode: string; op: 'filled' | 'not_filled' | 'eq' | 'contains'; value?: string }
  | { field: 'has_tag'; op: 'has' | 'has_not'; value: string }

export type Action =
  | { kind: 'create_task'; text: string; kindTag: string; inDays: number }
  | { kind: 'change_stage'; toStageId: string }
  | { kind: 'set_field'; fieldCode: string; value: string | number }
  | { kind: 'add_tag'; tag: string }
  | { kind: 'remove_tag'; tag: string }
  | { kind: 'add_note'; text: string }
  | { kind: 'open_whatsapp'; template: string } // gera link wa.me + rascunho
  | { kind: 'create_deal'; template: 'posvenda' | 'garantia'; atStageId: string }

// ---------- Legado (schema v1 — usado pela migração e pelo import v1) ----------
export interface DealV1 {
  id: string
  stage: string
  order: number
  customerName: string
  phone: string
  profile: 'bombista' | 'mecanico' | 'revendedor' | 'cliente_final'
  partCode: string
  application: string
  brand: string
  valueBRL: number
  lastContactAt: string
  closedAt: string | null
  notes: string
  activityLog: { at: string; type: 'created' | 'contact' | 'stage' | 'note'; text: string }[]
  createdAt: string
  updatedAt: string
}
