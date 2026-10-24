import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns'

export type RecencyLevel = 'green' | 'amber' | 'red'

export function daysSince(isoDate: string, now: Date = new Date()): number {
  return differenceInCalendarDays(startOfDay(now), startOfDay(parseISO(isoDate)))
}

export function recencyOf(isoDate: string, now: Date = new Date()): RecencyLevel {
  const d = daysSince(isoDate, now)
  return d < 7 ? 'green' : d <= 14 ? 'amber' : 'red'
}

export const RECENCY_META: Record<
  RecencyLevel,
  { label: string; dot: string; chip: string; border: string }
> = {
  green: {
    label: 'Ativo',
    dot: '🟢',
    chip: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    border: 'border-l-green-500/70',
  },
  amber: {
    label: 'Follow-up 7 dias',
    dot: '🟡',
    chip: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
    border: 'border-l-yellow-400',
  },
  red: {
    label: 'Follow-up 15+ dias',
    dot: '🔴',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    border: 'border-l-red-500',
  },
}

/** Variantes em ms epoch (schema v2: datas de domínio são ms). */
export function daysSinceMs(ms: number, now: Date = new Date()): number {
  return differenceInCalendarDays(startOfDay(now), startOfDay(new Date(ms)))
}

export function recencyOfMs(ms: number, now: Date = new Date()): RecencyLevel {
  const d = daysSinceMs(ms, now)
  return d < 7 ? 'green' : d <= 14 ? 'amber' : 'red'
}
