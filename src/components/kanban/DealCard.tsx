import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarCheck, Phone } from 'lucide-react'
import type { Deal } from '../../domain/types'
import { PROFILE_LABEL, PROFILE_CLASS, profileOf } from '../../domain/profile'
import { daysSinceMs, RECENCY_META, recencyOfMs } from '../../domain/recency'
import { fmtBRL, fmtPhone, waLink } from '../../domain/format'
import { lastContactMsOf, useCrmStore } from '../../store/useCrmStore'
import { openTaskCountOf } from '../../domain/indexes'
import { useUiStore } from '../../store/useUiStore'

export default function DealCard({ deal, overlay = false }: { deal: Deal; overlay?: boolean }) {
  const sortable = useSortable({ id: deal.id, data: { type: 'deal' }, disabled: overlay })
  const openDrawer = useUiStore((s) => s.openDrawer)
  const logContactToday = useCrmStore((s) => s.logContactToday)

  const contact = useCrmStore((s) => (deal.contactId ? s.data.contacts[deal.contactId] : undefined))
  const stageKind = useCrmStore((s) => s.data.stages[deal.stageId]?.kind)
  const lastMs = useCrmStore((s) => lastContactMsOf(s.data, deal.id))
  const openTasks = useCrmStore((s) => openTaskCountOf(s.data, deal.id))
  const phone = contact?.phone ?? ''
  const profile = profileOf(contact)
  const partCode = String(deal.custom['part_code'] ?? '')
  const application = String(deal.custom['application'] ?? '')
  const brand = String(deal.custom['brand'] ?? '')
  const closed = deal.closedAt ? new Date(deal.closedAt) : null

  const rec = recencyOfMs(lastMs)
  const days = daysSinceMs(lastMs)
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
        <h4 className="text-[13px] font-bold leading-tight tracking-tight">{deal.name}</h4>
        <span className="whitespace-nowrap font-mono text-[12px] font-bold text-accent">
          {fmtBRL(deal.priceCents)}
        </span>
      </div>

      <p className="mt-1 truncate font-mono text-[10.5px] text-ink-2">
        {partCode || '—'}
        {application ? ` · ${application}` : ''}
      </p>
      <p className="mt-0.5 truncate text-[10.5px] text-ink-2/80">
        {brand || '—'} · {fmtPhone(phone)}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {profile && (
          <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${PROFILE_CLASS[profile]}`}>
            {PROFILE_LABEL[profile]}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${meta.chip} ${rec === 'red' ? 'pulse-red' : ''}`}>
          {meta.dot} {days}d
        </span>
        {deal.stageId === 'warranty' && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[9.5px] font-bold text-gray-600 dark:bg-gray-500/20 dark:text-gray-300">
            Garantia
          </span>
        )}
        {closed && stageKind !== 'won' && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9.5px] font-bold text-green-700 dark:bg-green-500/15 dark:text-green-300">
            ✔ {String(closed.getDate()).padStart(2, '0')}/{String(closed.getMonth() + 1).padStart(2, '0')}
          </span>
        )}
        {openTasks > 0 && (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9.5px] font-bold text-accent" title="Tarefas abertas">
            ⏰ {openTasks}
          </span>
        )}
      </div>

      {!overlay && (
        <div className="mt-2 flex gap-1.5 border-t border-dashed border-line-soft pt-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 card-actions">
          <a
            href={waLink(phone)}
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
            <CalendarCheck size={11} /> Contato hoje
          </button>
        </div>
      )}
    </article>
  )
}
