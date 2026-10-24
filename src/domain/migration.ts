import { normalizePhone } from './format'
import { isProfile } from './profile'
import { lastContactActivityV1, seedCrmData } from '../store/seed'
import type { Activity, Contact, CrmData, Deal, DealV1 } from './types'

/**
 * Migração pura v1→v2 (spec §2): recebe os negócios do estado legado
 * (`{ deals: DealV1[] }` persistido na chave `crm.deals.v1`) e devolve um
 * CrmData v2. O "chassi" (pipelines/stages/customFields/lossReasons/sources/
 * settings) vem do seed; as coleções de dados do usuário são reconstruídas.
 * `nowMs` é o fallback para datas ilegíveis.
 */

const ACTIVITY_TYPE_MAP: Record<DealV1['activityLog'][number]['type'], Activity['type']> = {
  created: 'deal_created',
  stage: 'stage_changed',
  contact: 'contact_logged',
  note: 'note',
}

const parseOr = (iso: string, fallback: number): number => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? fallback : ms
}

export function dealsV1ToCrmDataV2(v1Deals: DealV1[], nowMs: number): CrmData {
  const chassis = seedCrmData()
  const contacts: Record<string, Contact> = {}
  const deals: Record<string, Deal> = {}
  const activities: Record<string, Activity> = {}

  for (const v1 of v1Deals) {
    const contactId = `c-${v1.id}`
    contacts[contactId] = {
      id: contactId,
      name: v1.customerName,
      phone: normalizePhone(v1.phone),
      createdAt: parseOr(v1.createdAt, nowMs),
      updatedAt: parseOr(v1.updatedAt, nowMs),
      custom: { profile: v1.profile },
    }

    deals[v1.id] = {
      id: v1.id,
      pipelineId: chassis.settings.defaultPipelineId,
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
      closedAt: v1.closedAt ? parseOr(v1.closedAt, nowMs) : null,
      custom: {
        part_code: v1.partCode,
        application: v1.application,
        brand: v1.brand,
        notes: v1.notes,
      },
      tags: [],
      createdAt: parseOr(v1.createdAt, nowMs),
      updatedAt: parseOr(v1.updatedAt, nowMs),
      createdBy: 'me',
      updatedBy: 'me',
    }

    v1.activityLog.forEach((item, idx) => {
      const act: Activity = {
        id: `act-${v1.id}-${idx}`,
        dealId: v1.id,
        type: ACTIVITY_TYPE_MAP[item.type],
        text: item.text,
        params:
          item.type === 'stage'
            ? [{ fieldId: 'stage', kind: 'text', oldValue: '', newValue: item.text }]
            : [],
        createdAt: parseOr(item.at, nowMs),
        authorName: 'me',
      }
      activities[act.id] = act
    })
    const lc = lastContactActivityV1(v1)
    if (lc) activities[lc.id] = lc
  }

  return {
    ...chassis,
    contacts,
    deals,
    activities,
    // migração não ativa regras em dados legados sem pedido; o seed novo traz as 6
    automations: [],
  }
}

/** Guarda de formato: é o estado persistido v1 (`{ deals: DealV1[] }`)? */
export function isV1State(s: unknown): s is { deals: DealV1[] } {
  if (typeof s !== 'object' || s === null) return false
  const maybe = s as { deals?: unknown }
  if (!Array.isArray(maybe.deals)) return false
  const first = maybe.deals[0] as { stage?: unknown; activityLog?: unknown } | undefined
  if (typeof first !== 'object' || first === null) return false
  return typeof first.stage === 'string' && Array.isArray(first.activityLog)
}

/**
 * Normaliza um array cru do estado v1: aceita qualquer item com `id`/`stage`
 * string e preenche campos ausentes com defaults seguros, em vez de descartar
 * o lote inteiro quando só um item está incompleto (isV1State olha só o 1º).
 */
export function coerceV1Deals(raw: unknown[]): DealV1[] {
  const s = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
  const out: DealV1[] = []
  raw.forEach((item, i) => {
    if (typeof item !== 'object' || item === null) return
    const d = item as Partial<Record<keyof DealV1, unknown>>
    if (typeof d.id !== 'string' || typeof d.stage !== 'string') return
    const created = s(d.createdAt, new Date().toISOString())
    out.push({
      id: d.id,
      stage: d.stage,
      order: typeof d.order === 'number' ? d.order : i,
      customerName: s(d.customerName, 'Sem nome'),
      phone: s(d.phone),
      profile: isProfile(d.profile) ? d.profile : 'cliente_final',
      partCode: s(d.partCode),
      application: s(d.application),
      brand: s(d.brand),
      valueBRL: typeof d.valueBRL === 'number' ? d.valueBRL : 0,
      lastContactAt: s(d.lastContactAt, created.slice(0, 10)),
      closedAt: typeof d.closedAt === 'string' ? d.closedAt : null,
      notes: s(d.notes),
      activityLog: Array.isArray(d.activityLog)
        ? (d.activityLog as Partial<DealV1['activityLog'][number]>[])
            .filter((a) => a && typeof a.at === 'string' && typeof a.type === 'string' && a.type in ACTIVITY_TYPE_MAP)
            .map((a) => ({ at: a.at!, type: a.type!, text: s(a.text) }))
        : [],
      createdAt: created,
      updatedAt: s(d.updatedAt, created),
    })
  })
  return out
}
