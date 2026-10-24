import { useMemo } from 'react'
import type { Deal } from '../../domain/types'
import { pipelineStages, useCrmStore } from '../../store/useCrmStore'
import Column from './Column'

export default function Board({ deals }: { deals: Deal[] }) {
  const data = useCrmStore((s) => s.data)
  const stages = useMemo(() => pipelineStages(data), [data])

  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>()
    for (const s of stages) map.set(s.id, [])
    for (const d of deals) map.get(d.stageId)?.push(d)
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [deals, stages])

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 py-4">
      <div className="flex h-full min-w-max gap-3">
        {stages.map((stage, i) => (
          <Column
            key={stage.id}
            stage={stage}
            deals={byStage.get(stage.id) ?? []}
            index={i}
          />
        ))}
      </div>
    </div>
  )
}
