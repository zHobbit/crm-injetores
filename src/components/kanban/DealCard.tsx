import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarCheck1, Phone } from 'lucide-react'
import type { Deal } from '../../domain/types'
import { PROFILE_LABEL, PROFILE_CLASS } from '../../domain/types'
import { daysSince, RECENCY_META, recencyOf } from '../../domain/recency'
import { fmtBRL, fmtPhone, waLink } from '../../domain/format'
import { useCrmStore } from '../../store/useCrmStore'
import { useUiStore } from '../../store/useUiStore'

export default function DealCard({ deal, overlay = false }: { deal: Deal; overlay?: boolean }) {
  const sortable = useSortable({ id: deal.id, data: { type: 'deal' }, disabled: overlay })
  const openDrawer = useUiStore((s) => s.openDrawer)
  const logContactToday = useCrmStore((s) => s.logContactToday)

  const rec = recencyOf(deal.lastContactAt)
  const days = daysSince(deal.lastContactAt)
  const meta = RECENCY_META[rec]

  const style = overlay
    ? undefined
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        animationDelay: `${(deal.order % 8) * 40}ms`,
      }

  return (
    <article
      ref={overlay ? undefined : sortable.setNodeRef}
      style={style}
      {...(overlay ? {} : { ...sortable.attributes, ...sortable.listeners })}
      onClick={() => openDrawer(deal.id)}
      className={`deal-card card-in group relative mb-2 cursor-grab rounded-lg border border-line-soft border-l-[3.5px] bg-surface p-2.5 ${meta.border} ${
        sortable.isDragging ? 'opacity-35' : ''
      } ${overlay ? 'shadow-2xl ring-1 ring-accent/40' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] font-bold leading-tight tracking-tight">{deal.customerName}</h4>
        <span className="whitespace-nowrap font-mono text-[12px] font-bold text-accent">
          {fmtBRL(deal.valueBRL)}
        </span>
      </div>

      <p className="mt-1 truncate font-mono text-[10.5px] text-ink-2">
        {deal.partCode || '—'}
        {deal.application ? ` · ${deal.application}` : ''}
      </p>
      <p className="mt-0.5 truncate text-[10.5px] text-ink-2/80">
        {deal.brand} · {fmtPhone(deal.phone)}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${PROFILE_CLASS[deal.profile]}`}>
          {PROFILE_LABEL[deal.profile]}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${meta.chip} ${rec === 'red' ? 'pulse-red' : ''}`}>
          {meta.dot} {days}d
        </span>
        {deal.stage === 'warranty' && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[9.5px] font-bold text-gray-600 dark:bg-gray-500/20 dark:text-gray-300">
            Garantia
          </span>
        )}
        {deal.closedAt && deal.stage !== 'won' && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9.5px] font-bold text-green-700 dark:bg-green-500/15 dark:text-green-300">
            ✔ {deal.closedAt.slice(8).padStart(2, '0')}/{deal.closedAt.slice(5, 7)}
          </span>
        )}
      </div>

      {!overlay && (
        <div className="mt-2 flex gap-1.5 border-t border-dashed border-line-soft pt-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 card-actions">
          <a
            href={waLink(deal.phone)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1 rounded-md bg-green-600/10 px-2 py-1 text-[10.5px] font-bold text-green-600 transition hover:bg-green-600/20 dark:text-green-400"
          >
            <Phone size={11} /> WhatsApp
          </a>
          <button
            onClick={(e) => {
              e.stopPropagation()
              logContactToday(deal.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[10.5px] font-bold text-accent transition hover:bg-accent/20"
            title="Registrar contato de hoje (1 clique)"
          >
            <CalendarCheck1 size={11} /> Contato hoje
          </button>
        </div>
      )}
    </article>
  )
}
