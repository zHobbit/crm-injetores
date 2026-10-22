import { useMemo, useRef, useState } from 'react'
import { FileUp, Users, X } from 'lucide-react'
import { useCrmStore } from '../../store/useCrmStore'
import { useUiStore } from '../../store/useUiStore'
import { parseContacts } from '../../lib/vcard'
import { fmtPhone, normalizePhone } from '../../domain/format'

export default function ImportModal() {
  const open = useUiStore((s) => s.importOpen)
  const setOpen = useUiStore((s) => s.setImportOpen)
  const deals = useCrmStore((s) => s.deals)
  const importDeals = useCrmStore((s) => s.importDeals)
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const preview = useMemo(() => {
    if (!text.trim()) return []
    const existing = new Set(deals.map((d) => normalizePhone(d.phone)).filter(Boolean))
    const seen = new Set<string>()
    return parseContacts(text).map((c) => {
      const digits = normalizePhone(c.phone)
      const dup = !digits || existing.has(digits) || seen.has(digits)
      if (digits && !dup) seen.add(digits)
      return { ...c, digits, dup }
    })
  }, [text, deals])

  const newCount = preview.filter((p) => !p.dup).length

  if (!open) return null

  const confirm = () => {
    const added = importDeals(preview.filter((p) => !p.dup).map((p) => ({ customerName: p.customerName, phone: p.digits })))
    alert(`${added} contato(s) importado(s) para Triagem.`)
    setText('')
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fade-in absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="drawer-in relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-[14px] font-extrabold tracking-tight">
            <Users size={16} className="text-accent" /> Importar contatos da agenda
          </h2>
          <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Fechar">
            <X size={17} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-[12px] leading-relaxed text-ink-2">
            Exporte seus contatos do celular como <b>.vcf (vCard)</b> ou <b>.csv</b> (Google Contatos: Exportar → CSV) e
            cole abaixo ou selecione o arquivo. Duplicados por telefone são ignorados e os novos entram em{' '}
            <b>📥 Triagem</b>.
          </p>

          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2.5 text-[12.5px] font-semibold text-ink-2 transition hover:border-accent/60 hover:text-accent"
          >
            <FileUp size={15} /> Selecionar arquivo .vcf / .csv
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".vcf,.csv,text/vcard,text/comma-separated-values"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) setText(await f.text())
              e.target.value = ''
            }}
          />

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11.5px] outline-none placeholder:text-ink-2/60 focus:border-accent/60 resize-none"
            placeholder={'BEGIN:VCARD\nFN:João Bombista\nTEL;CELL:+55 81 99988-1122\nEND:VCARD'}
          />

          {preview.length > 0 && (
            <div className="rounded-lg border border-line-soft bg-bg p-3">
              <div className="mb-2 flex justify-between text-[11px] font-bold uppercase tracking-wider text-ink-2">
                <span>Pré-visualização</span>
                <span>
                  <b className="text-green-600 dark:text-green-400">{newCount} novos</b> · {preview.length - newCount} duplicados
                </span>
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-[12px]">
                {preview.slice(0, 50).map((p, i) => (
                  <li key={i} className={`flex justify-between ${p.dup ? 'opacity-40 line-through' : ''}`}>
                    <span className="truncate">{p.customerName}</span>
                    <span className="ml-3 flex-shrink-0 font-mono text-[11px] text-ink-2">{p.digits ? fmtPhone(p.digits) : 'sem telefone'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="flex gap-2 border-t border-line px-5 py-4">
          <button onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-line py-2.5 text-[12.5px] font-bold text-ink-2 transition hover:bg-surface-2">
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={newCount === 0}
            className="flex-1 rounded-lg bg-accent py-2.5 text-[12.5px] font-extrabold text-bg-deep transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#161310]"
          >
            Importar {newCount > 0 ? `${newCount} contato(s)` : ''}
          </button>
        </footer>
      </div>
    </div>
  )
}
