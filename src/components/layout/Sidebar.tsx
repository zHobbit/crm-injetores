import { useMemo, useRef } from 'react'
import { Gauge, LayoutGrid, Upload, Download, FileJson, RotateCcw, Sun, Moon, X } from 'lucide-react'
import { useCrmStore } from '../../store/useCrmStore'
import { useUiStore } from '../../store/useUiStore'
import { fmtBRL } from '../../domain/format'
import { recencyOf } from '../../domain/recency'
import { exportJson, importJson } from '../../lib/exportImport'

const PRE_SALE = new Set(['triage', 'quote', 'waiting', 'negotiation'])

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const deals = useCrmStore((s) => s.deals)
  const resetSeed = useCrmStore((s) => s.resetSeed)
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const setImportOpen = useUiStore((s) => s.setImportOpen)
  const restoreRef = useRef<HTMLInputElement>(null)

  const metrics = useMemo(() => {
    const pipeline = deals.filter((d) => PRE_SALE.has(d.stage)).reduce((a, d) => a + d.valueBRL, 0)
    const closed = deals.filter((d) => d.closedAt).reduce((a, d) => a + d.valueBRL, 0)
    const followUps = deals.filter((d) => recencyOf(d.lastContactAt) !== 'green').length
    return { pipeline, closed, followUps, total: deals.length }
  }, [deals])

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col gap-5 border-r border-line bg-surface p-5 transition-transform duration-250 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30">
              <Gauge size={22} strokeWidth={2.4} />
            </div>
            <div>
              <div className="text-[15px] font-extrabold tracking-tight leading-none">
                Diesel<span className="text-accent">Pipe</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-2 mt-1">
                CRM · Injetores & Bombas
              </div>
            </div>
          </div>
          <button className="lg:hidden text-ink-2" onClick={onClose} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          <NavItem icon={<LayoutGrid size={16} />} label="Quadro de vendas" active />
          <NavItem icon={<Upload size={16} />} label="Importar contatos" onClick={() => { setImportOpen(true); onClose() }} />
          <NavItem icon={<Download size={16} />} label="Backup (JSON)" onClick={() => exportJson(deals)} />
          <NavItem icon={<FileJson size={16} />} label="Restaurar backup" onClick={() => restoreRef.current?.click()} />
          <input
            ref={restoreRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                const restored = await importJson(f)
                if (confirm(`Restaurar ${restored.length} negociação(s) do backup? Os dados atuais serão substituídos.`)) {
                  useCrmStore.getState().replaceAll(restored)
                }
              } catch {
                alert('Arquivo de backup inválido.')
              }
            }}
          />
          <NavItem
            icon={<RotateCcw size={16} />}
            label="Restaurar dados demo"
            onClick={() => {
              if (confirm('Substituir os dados atuais pelos dados de exemplo?')) resetSeed()
            }}
          />
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <div className="rounded-xl border border-line-soft bg-bg p-4">
            <Metric label="Pipeline aberto" value={fmtBRL(metrics.pipeline)} strong />
            <Metric label="Vendas concluídas" value={fmtBRL(metrics.closed)} />
            <div className="my-2.5 h-px bg-line-soft" />
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ink-2">Follow-ups pendentes</span>
              <span className={`font-mono text-sm font-bold ${metrics.followUps ? 'text-red-500' : 'text-green-500'}`}>
                {metrics.followUps}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-xs text-ink-2">Negociações</span>
              <span className="font-mono text-sm font-bold">{metrics.total}</span>
            </div>
          </div>

          <button
            onClick={toggleTheme}
            className="flex items-center justify-center gap-2 rounded-xl border border-line-soft py-2.5 text-sm font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          </button>
        </div>
      </aside>
    </>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition ${
        active
          ? 'bg-accent/12 text-accent ring-1 ring-accent/25'
          : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-xs text-ink-2">{label}</span>
      <span className={`font-mono font-bold ${strong ? 'text-[15px] text-accent' : 'text-sm'}`}>{value}</span>
    </div>
  )
}
