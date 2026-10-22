import { format } from 'date-fns'
import type { Deal } from '../domain/types'

export interface Snapshot {
  schemaVersion: 1
  exportedAt: string
  deals: Deal[]
}

export function exportJson(deals: Deal[]) {
  const snapshot: Snapshot = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    deals,
  }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `crm-backup-${format(new Date(), 'yyyy-MM-dd')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importJson(file: File): Promise<Deal[]> {
  const parsed = JSON.parse(await file.text()) as Partial<Snapshot>
  if (!Array.isArray(parsed.deals)) throw new Error('Arquivo sem a lista "deals"')
  return parsed.deals.filter((d) => d && typeof d.id === 'string' && typeof d.stage === 'string')
}
