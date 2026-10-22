import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCrmStore } from './store/useCrmStore'
import { useUiStore } from './store/useUiStore'
import { normalizePhone } from './domain/format'
import { recencyOf } from './domain/recency'
import type { Deal, StageId } from './domain/types'
import Sidebar from './components/layout/Sidebar'
import Topbar from './components/layout/Topbar'
import Board from './components/kanban/Board'
import DealCard from './components/kanban/DealCard'
import DealDrawer from './components/deal/DealDrawer'
import ImportModal from './components/deal/ImportModal'

export default function App() {
  const deals = useCrmStore((s) => s.deals)
  const moveDeal = useCrmStore((s) => s.moveDeal)
  const theme = useUiStore((s) => s.theme)
  const query = useUiStore((s) => s.query)
  const profileFilter = useUiStore((s) => s.profileFilter)
  const recencyFilter = useUiStore((s) => s.recencyFilter)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const visibleDeals = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qDigits = normalizePhone(q)
    return deals.filter((d) => {
      if (profileFilter !== 'all' && d.profile !== profileFilter) return false
      if (recencyFilter !== 'all' && recencyOf(d.lastContactAt) !== recencyFilter) return false
      if (!q) return true
      const digits = d.phone.replace(/\D/g, '')
      return (
        d.customerName.toLowerCase().includes(q) ||
        d.partCode.toLowerCase().includes(q) ||
        d.application.toLowerCase().includes(q) ||
        (qDigits.length >= 6 && digits.includes(qDigits))
      )
    })
  }, [deals, query, profileFilter, recencyFilter])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragStart = (e: DragStartEvent) => {
    const deal = deals.find((d) => d.id === e.active.id)
    if (deal) setActiveDeal(deal)
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDeal(null)
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const overDeal = deals.find((d) => d.id === overId)
    const activeDeal = deals.find((d) => d.id === activeId)
    if (!activeDeal) return

    let toStage: StageId
    if (overDeal) toStage = overDeal.stage
    else toStage = overId as StageId

    if (!overDeal && activeDeal.stage === toStage) {
      // soltou na própria coluna: moveDeal mantém posição relativa
    }

    moveDeal(activeId, toStage, overDeal?.id)
  }

  return (
    <div className="relative z-10 flex h-full overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setSidebarOpen(true)} />
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <Board deals={visibleDeals} />
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
            {activeDeal ? (
              <div className="rotate-2 opacity-95">
                <DealCard deal={activeDeal} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
      <DealDrawer />
      <ImportModal />
    </div>
  )
}
