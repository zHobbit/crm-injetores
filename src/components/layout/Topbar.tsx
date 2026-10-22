import { Search, Plus, Upload, Menu, X } from 'lucide-react'
import { useUiStore } from '../../store/useUiStore'
import { useCrmStore } from '../../store/useCrmStore'
import { exportJson } from '../../lib/exportImport'
import { PROFILES, PROFILE_LABEL, PROFILE_CLASS } from '../../domain/types'
import type { Profile } from '../../domain/types'

export default function Topbar({ onMenu }: { onMenu: () => void }) {
  const query = useUiStore((s) => s.query)
  const setQuery = useUiStore((s) => s.setQuery)
  const profileFilter = useUiStore((s) => s.profileFilter)
  const setProfileFilter = useUiStore((s) => s.setProfileFilter)
  const recencyFilter = useUiStore((s) => s.recencyFilter)
  const setRecencyFilter = useUiStore((s) => s.setRecencyFilter)
  const openDrawer = useUiStore((s) => s.openDrawer)
  const setImportOpen = useUiStore((s) => s.setImportOpen)
  const deals = useCrmStore((s) => s.deals)

  const hasFilters = profileFilter !== 'all' || recencyFilter !== 'all' || query !== ''

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface/70 px-4 py-3 backdrop-blur">
      <button className="lg:hidden text-ink-2" onClick={onMenu} aria-label="Abrir menu">
        <Menu size={20} />
      </button>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente, telefone ou código…"
          className="w-56 rounded-lg border border-line bg-bg py-2 pl-9 pr-8 text-[13px] outline-none placeholder:text-ink-2/70 focus:border-accent/60 focus:ring-2 focus:ring-accent/20 sm:w-72"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-2 hover:text-ink"
            aria-label="Limpar busca"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={profileFilter === 'all' && recencyFilter === 'all'} onClick={() => { setProfileFilter('all'); setRecencyFilter('all') }}>
          Todas
        </Chip>
        {PROFILES.map((p: Profile) => (
          <Chip key={p} active={profileFilter === p} tone={PROFILE_CLASS[p]} onClick={() => setProfileFilter(profileFilter === p ? 'all' : p)}>
            {PROFILE_LABEL[p]}
          </Chip>
        ))}
        <Chip active={recencyFilter === 'amber'} onClick={() => setRecencyFilter(recencyFilter === 'amber' ? 'all' : 'amber')} tone="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300">
          🟡 7 dias
        </Chip>
        <Chip active={recencyFilter === 'red'} onClick={() => setRecencyFilter(recencyFilter === 'red' ? 'all' : 'red')} tone="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          🔴 15+ dias
        </Chip>
        {hasFilters && (
          <button
            onClick={() => { setQuery(''); setProfileFilter('all'); setRecencyFilter('all') }}
            className="text-[11.5px] font-semibold text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            limpar
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => exportJson(deals)}
          title="Exportar backup JSON"
          className="hidden rounded-lg border border-line p-2 text-ink-2 transition hover:bg-surface-2 hover:text-ink md:block"
        >
          <Upload size={15} className="rotate-180" />
        </button>
        <button
          onClick={() => setImportOpen(true)}
          className="hidden items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink md:flex"
        >
          <Upload size={15} /> Importar
        </button>
        <button
          onClick={() => openDrawer(null)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-bold text-bg-deep shadow transition hover:brightness-110 active:scale-95 dark:text-[#161310]"
        >
          <Plus size={16} strokeWidth={2.6} /> Novo Card
        </button>
      </div>
    </header>
  )
}

function Chip({
  active,
  tone,
  children,
  onClick,
}: {
  active?: boolean
  tone?: string
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold transition active:scale-95 ${
        tone ?? 'bg-surface-2 text-ink-2 hover:text-ink'
      } ${active ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg' : ''} ${
        active ? 'opacity-100 scale-105' : 'opacity-80 hover:opacity-100'
      } ${!tone && active ? 'bg-accent/15 text-accent' : ''}`}
    >
      {children}
    </button>
  )
}
