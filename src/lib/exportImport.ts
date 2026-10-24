import { format } from 'date-fns'
import type { CrmData } from '../domain/types'
import { coerceV1Deals, dealsV1ToCrmDataV2 } from '../domain/migration'
import { hasV2Skeleton } from '../domain/sanitize'

export interface Snapshot {
  schemaVersion: 2
  exportedAt: string
  data: CrmData
}

export function exportJson(data: CrmData) {
  const snapshot: Snapshot = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    data,
  }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `crm-backup-${format(new Date(), 'yyyy-MM-dd')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Aceita snapshot v2 (`{ data }`) e v1 legado (`{ deals: DealV1[] }`, migrado na hora).
 * Só valida o esqueleto: merge com o seed + saneamento ficam num único ponto (replaceAll).
 */
export function parseSnapshot(parsed: unknown): CrmData {
  const p = parsed as { schemaVersion?: number; data?: CrmData; deals?: unknown } | null
  if (p?.data && p.data.version === 2) {
    if (!hasV2Skeleton(p.data)) throw new Error('Backup v2 sem etapas ou negociações')
    return p.data
  }
  if (p && Array.isArray(p.deals)) return dealsV1ToCrmDataV2(coerceV1Deals(p.deals), Date.now())
  throw new Error('Backup sem "data" v2 nem "deals" v1')
}

export async function importJson(file: File): Promise<CrmData> {
  return parseSnapshot(JSON.parse(await file.text()))
}
