import { format, subDays } from 'date-fns'
import { normalizePhone } from '../domain/format'
import type {
  Activity,
  AutomationRule,
  CrmData,
  CustomField,
  DealV1,
  LossReason,
  Pipeline,
  Source,
  Stage,
} from '../domain/types'

/**
 * Seed v2 — mesmo conteúdo de negócio do seed v1 (10 negociações de peças
 * diesel, mesmos notes/activityLog), agora no modelo normalizado CrmData.
 * Datas continuam relativas a "hoje" (comportamento do seed antigo) para o
 * espelho de recency verde/amarelo/vermelho funcionar em qualquer dia.
 */

const PIPE_MAIN = 'pipe-main'

const iso = (daysAgo: number) => format(subDays(new Date(), daysAgo), 'yyyy-MM-dd')
const ts = (daysAgo: number) => subDays(new Date(), daysAgo).toISOString()

// ---------- negócios v1 (fonte: seed antigo, conteúdo preservado verbatim) ----------
let seq = 0
const base = (stage: DealV1['stage'], order: number) => ({
  id: `seed-${++seq}`,
  stage,
  order,
  closedAt: null as string | null,
  notes: '',
  activityLog: [] as DealV1['activityLog'],
  createdAt: ts(30),
  updatedAt: ts(2),
})

const SEED_SOURCE: DealV1[] = [
  {
    ...base('triage', 0),
    customerName: 'Diesel Bomar Ltda',
    phone: '5581999881122',
    profile: 'bombista',
    partCode: '0445110376',
    application: 'Injetor Amarok 2.0 TDI',
    brand: 'Bosch',
    valueBRL: 320000,
    lastContactAt: iso(2),
    notes: 'Pediu 4 unidades com bicos novos. Cobrar posição do orçamento.',
    activityLog: [{ at: ts(2), type: 'created', text: 'Contato criado via WhatsApp' }],
  },
  {
    ...base('triage', 1),
    customerName: 'Garagem do Zé',
    phone: '5581988772211',
    profile: 'mecanico',
    partCode: '2822010216',
    application: 'Bomba CPA1 — Cummins 6BT',
    brand: 'Delphi',
    valueBRL: 450000,
    lastContactAt: iso(9),
    notes: 'Bomba com retorno vazando; quer teste antes de comprar.',
    activityLog: [{ at: ts(9), type: 'contact', text: 'Enviado vídeo do teste de bancada' }],
  },
  {
    ...base('triage', 2),
    customerName: 'Vale Transporte ME',
    phone: '5511977661234',
    profile: 'cliente_final',
    partCode: '0414723073',
    application: 'Bomba Hilux 3.0 D4D',
    brand: 'Denso',
    valueBRL: 120000,
    lastContactAt: iso(21),
    notes: 'Frota parada — prioridade alta, Cliente sumiu após orçamento.',
    activityLog: [],
  },
  {
    ...base('quote', 0),
    customerName: 'Injetec Peças',
    phone: '554133221100',
    profile: 'revendedor',
    partCode: '0445120247',
    application: 'Injetor Ranger 3.2 PUMA',
    brand: 'Bosch',
    valueBRL: 780000,
    lastContactAt: iso(1),
    notes: 'Cotação para 6 pcs + tabela de revenda mensal.',
    activityLog: [{ at: ts(1), type: 'contact', text: 'Proposta comercial enviada por WhatsApp' }],
  },
  {
    ...base('quote', 1),
    customerName: 'Auto Diesel Sul',
    phone: '5551991234567',
    profile: 'bombista',
    partCode: 'CP19 8-97151-021',
    application: 'Bomba Civic D15 — recondicionada',
    brand: 'Bosch',
    valueBRL: 450000,
    lastContactAt: iso(12),
    notes: 'Aguardando confirmação de usinagem do corpo.',
    activityLog: [],
  },
  {
    ...base('waiting', 0),
    customerName: 'Fazenda Santa Luzia',
    phone: '5564996543210',
    profile: 'cliente_final',
    partCode: '0950006543',
    application: 'Retificador EPB — MF 4.297',
    brand: 'Bosch',
    valueBRL: 295000,
    lastContactAt: iso(30),
    notes: 'Decide após safra. Sem resposta há 1 mês — reativar.',
    activityLog: [],
  },
  {
    ...base('negotiation', 0),
    customerName: 'Bombas & Diesel SP',
    phone: '5511944556677',
    profile: 'bombista',
    partCode: 'L1091310',
    application: 'Bico injetor S10 4.3 — 6 un',
    brand: 'Delphi',
    valueBRL: 640000,
    lastContactAt: iso(3),
    notes: 'Negociando pagamento 30/60 + frete por conta.',
    activityLog: [{ at: ts(3), type: 'contact', text: 'Ligação: pediu 5% de desconto no fechamento' }],
  },
  {
    ...base('won', 0),
    customerName: 'Transportes Ribeiro',
    phone: '5571993217654',
    profile: 'revendedor',
    partCode: '0445110521',
    application: 'Kit injetores Amarok (4x)',
    brand: 'Bosch',
    valueBRL: 990000,
    lastContactAt: iso(5),
    closedAt: iso(5),
    notes: 'Fechado com Nota. Enviar certificado de teste.',
    activityLog: [{ at: ts(5), type: 'stage', text: 'Venda concluída' }],
  },
  {
    ...base('postsale', 0),
    customerName: 'Frotamax Log',
    phone: '5585998701122',
    profile: 'revendedor',
    partCode: '2822010741',
    application: '6 bombas CPA — Sprinter OM611',
    brand: 'Continental',
    valueBRL: 2700000,
    lastContactAt: iso(4),
    closedAt: iso(18),
    notes: 'Rastrear NF-e 44812; 2 bombas com retorno antecipado.',
    activityLog: [{ at: ts(4), type: 'contact', text: 'Cliente confirmou recebimento' }],
  },
  {
    ...base('warranty', 0),
    customerName: 'Diego InJETores',
    phone: '5547992334455',
    profile: 'bombista',
    partCode: '0445110353',
    application: 'Injetor Golf TDI — garantia',
    brand: 'Bosch',
    valueBRL: 78000,
    lastContactAt: iso(8),
    notes: 'Retorno: falha de partida a frio. Análise técnica em bancada.',
    activityLog: [{ at: ts(8), type: 'note', text: 'Peça recebida, protocolo GT-1042' }],
  },
]

// ---------- coleções estáticas ----------
const pipelines: Record<string, Pipeline> = {
  [PIPE_MAIN]: {
    id: PIPE_MAIN,
    name: 'Peças Diesel',
    isMain: true,
    isArchive: false,
    unsortedEnabled: true,
    sort: 0,
  },
}

// Espelho do STAGES v1 (id, label, accent, emoji) — Addendum A1: won → 'won', demais 'open'.
const STAGE_SEED: { id: string; name: string; color: string; emoji: string; kind: Stage['kind'] }[] = [
  { id: 'triage', name: 'Triagem / Novo Contato', color: '#94a3b8', emoji: '📥', kind: 'open' },
  { id: 'quote', name: 'Cotação Enviada', color: '#38bdf8', emoji: '📋', kind: 'open' },
  { id: 'waiting', name: 'Aguardando Resposta', color: '#fbbf24', emoji: '⏳', kind: 'open' },
  { id: 'negotiation', name: 'Em Negociação', color: '#fb923c', emoji: '🤝', kind: 'open' },
  { id: 'won', name: 'Venda Concluída', color: '#4ade80', emoji: '✅', kind: 'won' },
  { id: 'postsale', name: 'Pós-Venda & Rastreio', color: '#2dd4bf', emoji: '🚚', kind: 'open' },
  { id: 'warranty', name: 'Garantia / Análise Técnica', color: '#a78bfa', emoji: '🛡️', kind: 'open' },
]

const stages: Record<string, Stage> = Object.fromEntries(
  STAGE_SEED.map((s, i) => [
    s.id,
    { ...s, pipelineId: PIPE_MAIN, sort: i, editable: true },
  ]),
)

const enumOf = (fieldId: string, values: string[]): CustomField['enums'] =>
  values.map((value, i) => ({ id: `${fieldId}-e${i}`, value, sort: i }))

const FIELD_DEFAULTS = {
  multiple: false,
  requiredInStageIds: [] as string[],
  visible: true,
  filterable: true,
  sortable: true,
  predefined: true,
} as const

const customFields: Record<string, CustomField> = {
  'cf-profile': {
    id: 'cf-profile',
    code: 'profile',
    name: 'Perfil',
    kind: 'select',
    scopes: ['contact'],
    sort: 0,
    enums: enumOf('cf-profile', ['bombista', 'mecanico', 'revendedor', 'cliente_final']),
    ...FIELD_DEFAULTS,
  },
  'cf-brand': {
    id: 'cf-brand',
    code: 'brand',
    name: 'Marca',
    kind: 'select',
    scopes: ['deal'],
    sort: 1,
    enums: enumOf('cf-brand', ['Bosch', 'Delphi', 'Denso', 'Continental', 'Outra']),
    ...FIELD_DEFAULTS,
  },
  'cf-part_code': {
    id: 'cf-part_code',
    code: 'part_code',
    name: 'Código da peça',
    kind: 'text',
    scopes: ['deal'],
    sort: 2,
    enums: [],
    ...FIELD_DEFAULTS,
  },
  'cf-application': {
    id: 'cf-application',
    code: 'application',
    name: 'Aplicação',
    kind: 'text',
    scopes: ['deal'],
    sort: 3,
    enums: [],
    ...FIELD_DEFAULTS,
  },
  'cf-notes': {
    id: 'cf-notes',
    code: 'notes',
    name: 'Observações',
    kind: 'textarea',
    scopes: ['deal'],
    sort: 4,
    enums: [],
    ...FIELD_DEFAULTS,
  },
}

const lossReasons: Record<string, LossReason> = {
  'lr-1': { id: 'lr-1', name: 'Preço', sort: 0 },
  'lr-2': { id: 'lr-2', name: 'Sem resposta', sort: 1 },
  'lr-3': { id: 'lr-3', name: 'Comprou de outro', sort: 2 },
}

const sources: Record<string, Source> = {
  'src-1': { id: 'src-1', name: 'WhatsApp', color: '#25D366', sort: 0 },
  'src-2': { id: 'src-2', name: 'Agenda de contatos', sort: 1 },
  'src-3': { id: 'src-3', name: 'Indicação', sort: 2 },
  'src-4': { id: 'src-4', name: 'Loja física', sort: 3 },
}

// ---------- automações (spec §3 "Kit mínimo" — 6 regras; engine só na Task 5) ----------
export const SEED_AUTOMATIONS: AutomationRule[] = [
  {
    id: 'auto-1',
    name: 'Tabela de revenda para revendedor',
    enabled: true,
    dealPipelineId: 'any',
    trigger: { kind: 'deal_created' },
    conditions: {
      logic: 'and',
      items: [{ field: 'profile', op: 'is', value: 'revendedor' }],
    },
    actions: [{ kind: 'create_task', text: 'montar tabela de revenda', kindTag: 'cotacao', inDays: 2 }],
    lastFiredAt: {},
  },
  {
    id: 'auto-2',
    name: 'Cobrar cotação em 3 dias',
    enabled: true,
    dealPipelineId: 'any',
    trigger: { kind: 'stage_changed', toStageId: 'quote' },
    conditions: { logic: 'and', items: [] },
    actions: [
      { kind: 'create_task', text: 'cobrar cotação', kindTag: 'acompanhar', inDays: 3 },
      { kind: 'add_tag', tag: 'aguardando' },
    ],
    lastFiredAt: {},
  },
  {
    id: 'auto-3',
    name: 'Follow-up WhatsApp após 7 dias sem contato',
    enabled: true,
    dealPipelineId: 'any',
    trigger: { kind: 'days_no_contact', days: 7 },
    conditions: {
      logic: 'and',
      items: [{ field: 'stage', op: 'in', value: ['quote', 'waiting'] }],
    },
    actions: [
      {
        kind: 'open_whatsapp',
        template: 'Olá! Passando para saber se ficou alguma dúvida sobre a cotação das peças.',
      },
    ],
    cooldown: 86400,
    lastFiredAt: {},
  },
  {
    id: 'auto-4',
    name: 'Reativar ou encerrar após 15 dias',
    enabled: true,
    dealPipelineId: 'any',
    trigger: { kind: 'days_no_contact', days: 15 },
    // spec: "stage ∉ {won}" — Condition só tem op 'in', então listamos todas menos 'won'
    conditions: {
      logic: 'and',
      items: [
        {
          field: 'stage',
          op: 'in',
          value: ['triage', 'quote', 'waiting', 'negotiation', 'postsale', 'warranty'],
        },
      ],
    },
    actions: [
      { kind: 'create_task', text: 'reativar / encerrar', kindTag: 'acompanhar', inDays: 0 },
      // spec: "+ field_changed de decisão" — Action não tem kind 'field_changed';
      // aproximação declarativa: nota registrando a decisão pendente.
      { kind: 'add_note', text: 'Sem contato há 15+ dias — decidir: reativar ou encerrar.' },
    ],
    lastFiredAt: {},
  },
  {
    id: 'auto-5',
    name: 'Pós-venda ao ganhar',
    enabled: true,
    dealPipelineId: 'any',
    trigger: { kind: 'stage_changed', toStageId: 'won' },
    conditions: { logic: 'and', items: [] },
    actions: [
      { kind: 'create_deal', template: 'posvenda', atStageId: 'postsale' },
      { kind: 'create_task', text: 'enviar certificado de teste', kindTag: 'posvenda', inDays: 1 },
    ],
    lastFiredAt: {},
  },
  {
    id: 'auto-6',
    name: 'Retorno antecipado → garantia',
    enabled: true,
    dealPipelineId: 'any',
    trigger: { kind: 'tag_changed', action: 'added' },
    conditions: {
      logic: 'and',
      items: [{ field: 'has_tag', op: 'has', value: 'retorno-antecipado' }],
    },
    actions: [
      { kind: 'change_stage', toStageId: 'warranty' },
      { kind: 'create_task', text: 'análise de bancada', kindTag: 'garantia', inDays: 1 },
    ],
    lastFiredAt: {},
  },
]

// ---------- mapeamento v1 → v2 ----------
const ACTIVITY_TYPE_MAP: Record<DealV1['activityLog'][number]['type'], Activity['type']> = {
  created: 'deal_created',
  stage: 'stage_changed',
  contact: 'contact_logged',
  note: 'note',
}

const toActivity = (
  dealId: string,
  idx: number,
  item: DealV1['activityLog'][number],
): Activity => ({
  id: `act-${dealId}-${idx}`,
  dealId,
  type: ACTIVITY_TYPE_MAP[item.type],
  text: item.text,
  params:
    item.type === 'stage'
      ? [{ fieldId: 'stage', kind: 'text', oldValue: '', newValue: item.text }]
      : [],
  createdAt: Date.parse(item.at),
  authorName: 'me',
})

// ---------- seedCrmData ----------
export function seedCrmData(): CrmData {
  const contacts: CrmData['contacts'] = {}
  const deals: CrmData['deals'] = {}
  const activities: CrmData['activities'] = {}

  for (const v1 of SEED_SOURCE) {
    const contactId = `c-${v1.id.replace(/^seed-/, '')}`
    contacts[contactId] = {
      id: contactId,
      name: v1.customerName,
      phone: normalizePhone(v1.phone),
      createdAt: Date.parse(v1.createdAt),
      updatedAt: Date.parse(v1.updatedAt),
      custom: { profile: v1.profile },
    }
    deals[v1.id] = {
      id: v1.id,
      pipelineId: PIPE_MAIN,
      stageId: v1.stage,
      unsorted: false,
      name: v1.customerName,
      contactId,
      companyId: null,
      order: v1.order,
      priceCents: v1.valueBRL,
      sourceId: null,
      lossReasonId: null,
      currency: 'BRL',
      closedAt: v1.closedAt ? Date.parse(v1.closedAt) : null,
      custom: {
        part_code: v1.partCode,
        application: v1.application,
        brand: v1.brand,
        notes: v1.notes,
      },
      tags: [],
      createdAt: Date.parse(v1.createdAt),
      updatedAt: Date.parse(v1.updatedAt),
      createdBy: 'me',
      updatedBy: 'me',
    }
    v1.activityLog.forEach((item, idx) => {
      const act = toActivity(v1.id, idx, item)
      activities[act.id] = act
    })
  }

  return {
    version: 2,
    pipelines,
    stages,
    customFields,
    catalogs: {},
    catalogElements: {},
    contacts,
    companies: {},
    deals,
    tasks: {},
    activities,
    lossReasons,
    sources,
    settings: {
      defaultPipelineId: PIPE_MAIN,
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
    },
    // cópia defensiva: engine grava lastFiredAt nas regras; resetSeed() precisa
    // devolver estado limpo sem vazar cooldowns entre instâncias
    automations: SEED_AUTOMATIONS.map((r) => ({ ...r, lastFiredAt: {} })),
  }
}
