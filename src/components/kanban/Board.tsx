import { useMemo } from 'react'
import { STAGES } from '../../domain/types'
import type { Deal } from '../../domain/types'
import Column from './Column'

export default function Board({ deals }: { deals: Deal[] }) {
  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>()
    for (const s of STAGES) map.set(s.id, [])
    for (const d of deals) map.get(d.stage)?.push(d)
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [deals])

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 py-4">
      <div className="flex h-full min-w-max gap-3">
        {STAGES.map((stage, i) => (
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
