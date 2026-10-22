import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { fmtBRL } from '../../domain/format'
import type { Deal, StageMeta } from '../../domain/types'
import DealCard from './DealCard'

export default function Column({
  stage,
  deals,
  index,
}: {
  stage: StageMeta
  deals: Deal[]
  index: number
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const total = deals.reduce((a, d) => a + d.valueBRL, 0)

  return (
    <section
      ref={setNodeRef}
      className={`flex h-full w-[268px] flex-col rounded-xl border transition-colors ${
        isOver ? 'border-accent/60 bg-accent/5' : 'border-line bg-surface/60'
      }`}
      style={{ animationDelay: `${index * 45}ms` }}
      aria-label={`Etapa ${stage.label}`}
    >
      <header
        className="flex items-center justify-between gap-2 rounded-t-xl border-b border-line-soft px-3 py-2.5"
        style={{ background: 'var(--col-head)' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: stage.accent }}
          />
          <span className="truncate text-[12.5px] font-bold tracking-tight">
            {stage.emoji} {stage.label}
          </span>
          <span className="rounded-full bg-ink/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink-2">
            {deals.length}
          </span>
        </div>
        <span className="whitespace-nowrap font-mono text-[11px] font-bold text-accent">
          {fmtBRL(total)}
        </span>
      </header>

      <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto p-2">
          {deals.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-1 text-center opacity-40">
              <span className="text-2xl">▢</span>
              <p className="text-[11px] leading-snug">
                Arraste uma negociação
                <br />
                para cá
              </p>
            </div>
          ) : (
            deals.map((deal) => <DealCard key={deal.id} deal={deal} />)
          )}
        </div>
      </SortableContext>
    </section>
  )
}
