import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  CalendarCheck,
  CheckSquare,
  MessageCircle,
  Phone,
  Plus,
  Save,
  StickyNote,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { pipelineStages, useCrmStore, useDealView, type DealInput2 } from '../../store/useCrmStore'
import { useUiStore } from '../../store/useUiStore'
import { PROFILES, PROFILE_LABEL, isProfile } from '../../domain/profile'
import type { Profile } from '../../domain/profile'
import type { ActivityType } from '../../domain/types'
import { fmtBRL, fmtDateTimeBRMs, normalizePhone, waLink } from '../../domain/format'
import { RECENCY_META, daysSinceMs, recencyOfMs } from '../../domain/recency'

function parseBRLToCents(s: string): number {
  const clean = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = Number(clean)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// Draft local do formulário: campos fixos atuais mapeados p/ v2
// (custom por code + perfil no contato). Campos dinâmicos completos: Task 8.
interface Draft {
  stageId: string
  name: string
  phone: string
  profile: Profile
  brand: string
  partCode: string
  application: string
  notes: string
}

const EMPTY: Draft = {
  stageId: '',
  name: '',
  phone: '',
  profile: 'bombista',
  brand: 'Bosch',
  partCode: '',
  application: '',
  notes: '',
}

const ACTIVITY_ICON: Partial<Record<ActivityType, typeof Plus>> = {
  contact_logged: Phone,
  stage_changed: ArrowRightLeft,
  note: StickyNote,
  task_created: CheckSquare,
  task_done: CheckSquare,
  tag_changed: Tag,
}

export default function DealDrawer() {
  const open = useUiStore((s) => s.drawerOpen)
  const dealId = useUiStore((s) => s.drawerDealId)
  const closeDrawer = useUiStore((s) => s.closeDrawer)
  const data = useCrmStore((s) => s.data)
  const view = useDealView(dealId)
  const deal = view?.deal ?? null
  const addDeal = useCrmStore((s) => s.addDeal)
  const updateDeal = useCrmStore((s) => s.updateDeal)
  const removeDeal = useCrmStore((s) => s.removeDeal)
  const logContactToday = useCrmStore((s) => s.logContactToday)
  const moveDeal = useCrmStore((s) => s.moveDeal)

  const stages = useMemo(() => pipelineStages(data), [data])
  const brands = useMemo(
    () =>
      (Object.values(data.customFields).find((f) => f.code === 'brand')?.enums ?? [])
        .slice()
        .sort((a, b) => a.sort - b.sort)
        .map((e) => e.value),
    [data.customFields],
  )
  const timeline = useMemo(
    () =>
      dealId
        ? Object.values(data.activities)
            .filter((a) => a.dealId === dealId)
            .sort((a, b) => b.createdAt - a.createdAt)
        : [],
    [data.activities, dealId],
  )

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [loaded, setLoaded] = useState<Draft>(EMPTY) // snapshot p/ enviar só campos de contato alterados
  const [valueStr, setValueStr] = useState('')

  useEffect(() => {
    if (!open) return
    if (view) {
      const { deal: d, contact } = view
      const profile = contact?.custom['profile']
      const initial: Draft = {
        stageId: d.stageId,
        name: d.name,
        phone: contact?.phone ?? '',
        profile: isProfile(profile) ? profile : 'cliente_final',
        brand: String(d.custom['brand'] ?? ''),
        partCode: String(d.custom['part_code'] ?? ''),
        application: String(d.custom['application'] ?? ''),
        notes: String(d.custom['notes'] ?? ''),
      }
      setDraft(initial)
      setLoaded(initial)
      setValueStr((d.priceCents / 100).toLocaleString('pt-BR'))
    } else {
      const initial = { ...EMPTY, stageId: stages[0]?.id ?? '' }
      setDraft(initial)
      setLoaded(initial)
      setValueStr('')
    }
  }, [open, dealId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeDrawer()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeDrawer])

  if (!open) return null

  const isNew = !deal
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  const toInput = (): DealInput2 => ({
    name: draft.name.trim(),
    phone: normalizePhone(draft.phone),
    pipelineId: deal?.pipelineId ?? data.settings.defaultPipelineId,
    stageId: draft.stageId,
    priceCents: parseBRLToCents(valueStr),
    custom: {
      ...deal?.custom,
      brand: draft.brand,
      part_code: draft.partCode,
      application: draft.application,
      notes: draft.notes,
    },
    // contrato do store: só o que mudou (novo card sempre envia; addDeal só preenche vazios)
    contactCustom: !deal || draft.profile !== loaded.profile ? { profile: draft.profile } : undefined,
  })

  const save = () => {
    if (!draft.name.trim()) return
    if (isNew) addDeal(toInput())
    else updateDeal(deal!.id, toInput())
    closeDrawer()
  }

  const setStage = (to: string) => {
    if (isNew || !deal) {
      patch({ stageId: to })
      return
    }
    updateDeal(deal.id, toInput())
    moveDeal(deal.id, to)
    patch({ stageId: to })
    setLoaded({ ...draft, stageId: to }) // o draft já foi salvo: vira a nova base do "sujo"
  }

  const registrarHoje = () => {
    if (!isNew && deal) logContactToday(deal.id)
  }

  const lastMs = view?.lastContactMs ?? Date.now()
  const rec = recencyOfMs(lastMs)
  const days = daysSinceMs(lastMs)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fade-in absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={closeDrawer} />
      <aside className="drawer-in relative flex h-full w-full max-w-[440px] flex-col border-l border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-extrabold tracking-tight">
              {isNew ? 'Nova negociação' : deal?.name}
            </h2>
            <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-ink-2">
              {isNew ? 'card vazio' : `desde ${fmtDateTimeBRMs(deal!.createdAt)}`}
            </p>
          </div>
          <button onClick={closeDrawer} className="rounded-lg p-2 text-ink-2 transition hover:bg-surface-2 hover:text-ink" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Field label="Etapa do funil">
            <select
              value={draft.stageId}
              onChange={(e) => setStage(e.target.value)}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent/60"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {s.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cliente / Empresa *">
              <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} className={inp} placeholder="Diesel Bomar Ltda" />
            </Field>
            <Field label="Telefone / WhatsApp">
              <input value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} className={inp} placeholder="81 99988-1122" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Perfil">
              <select value={draft.profile} onChange={(e) => patch({ profile: e.target.value as Profile })} className={inp}>
                {PROFILES.map((p) => (
                  <option key={p} value={p}>{PROFILE_LABEL[p]}</option>
                ))}
              </select>
            </Field>
            <Field label="Marca">
              <select value={draft.brand} onChange={(e) => patch({ brand: e.target.value })} className={inp}>
                {(brands.includes(draft.brand) || !draft.brand ? brands : [...brands, draft.brand]).map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Código da peça">
            <input value={draft.partCode} onChange={(e) => patch({ partCode: e.target.value })} className={`${inp} font-mono`} placeholder="0445110376" />
          </Field>

          <Field label="Aplicação">
            <input value={draft.application} onChange={(e) => patch({ application: e.target.value })} className={inp} placeholder="Injetor Amarok 2.0 TDI" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Orçamento (R$)">
              <input value={valueStr} onChange={(e) => setValueStr(e.target.value)} className={`${inp} font-mono`} placeholder="3.200,00" inputMode="decimal" />
            </Field>
            <Field label="Último contato">
              <input value={isNew ? '—' : fmtDateTimeBRMs(lastMs)} readOnly className={`${inp} font-mono opacity-70`} title="Use “Contato hoje” para registrar" />
            </Field>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-bg px-3 py-2 text-[11.5px]">
            <span className={`rounded-full px-2 py-0.5 font-bold ${RECENCY_META[rec].chip}`}>
              {RECENCY_META[rec].dot} {days <= 0 ? 'Hoje' : `${days} ${days === 1 ? 'dia' : 'dias'} atrás`}
            </span>
            <span className="font-mono text-accent">{fmtBRL(parseBRLToCents(valueStr))}</span>
          </div>

          <Field label="Observações / histórico">
            <textarea value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} rows={3} className={`${inp} resize-none`} placeholder="Ex: pediu 4 unidades com bicos novos…" />
          </Field>

          {!isNew && timeline.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-ink-2">Linha do tempo</h3>
              <ul className="space-y-1.5">
                {timeline.map((a) => {
                  const Icon = ACTIVITY_ICON[a.type] ?? Plus
                  const diffs = a.type === 'field_changed' ? a.params : []
                  return (
                    <li key={a.id} className="flex items-start gap-2 text-[12px]">
                      <span className="mt-0.5 text-ink-2">
                        <Icon size={12} />
                      </span>
                      <div>
                        <p className="leading-snug">{a.text}</p>
                        {diffs.map((p, i) => (
                          <p key={i} className="font-mono text-[10.5px] text-ink-2">
                            {p.fieldId}: {String(p.oldValue ?? '') || '∅'} → {String(p.newValue ?? '') || '∅'}
                          </p>
                        ))}
                        <p className="font-mono text-[10px] text-ink-2">{fmtDateTimeBRMs(a.createdAt)}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        <footer className="space-y-2 border-t border-line px-5 py-4">
          <div className="flex gap-2">
            <a
              href={waLink(draft.phone || view?.contact?.phone || '')}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600/15 py-2.5 text-[12.5px] font-bold text-green-600 transition hover:bg-green-600/25 dark:text-green-400"
            >
              <MessageCircle size={14} /> WhatsApp
            </a>
            <button
              onClick={registrarHoje}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent/15 py-2.5 text-[12.5px] font-bold text-accent transition hover:bg-accent/25"
            >
              <CalendarCheck size={14} /> Contato hoje
            </button>
            {!isNew && (
              <button
                onClick={() => {
                  if (deal && confirm(`Excluir a negociação "${deal.name}"?`)) {
                    removeDeal(deal.id)
                    closeDrawer()
                  }
                }}
                className="rounded-lg bg-red-500/10 px-3 py-2.5 text-red-500 transition hover:bg-red-500/20"
                aria-label="Excluir"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          <button
            onClick={save}
            disabled={!draft.name.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-[13px] font-extrabold text-bg-deep shadow transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#161310]"
          >
            <Save size={15} /> {isNew ? 'Criar negociação' : 'Salvar alterações'}
          </button>
        </footer>
      </aside>
    </div>
  )
}

const inp =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-ink-2/60 focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-2">{label}</span>
      {children}
    </label>
  )
}
