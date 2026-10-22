import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

export const fmtBRL = (cents: number) => brl.format(cents / 100)

export const fmtBRLShort = (cents: number) =>
  cents >= 100_000_00 ? `R$ ${(cents / 1000000).toFixed(1).replace('.', ',')}M` : brl.format(cents / 100)

export const todayISO = () => format(new Date(), 'yyyy-MM-dd')

export const fmtDateBR = (iso: string) => {
  try {
    return format(parseISO(iso), 'dd/MM/yyyy', { locale: ptBR })
  } catch {
    return iso
  }
}

export const fmtDateTimeBR = (iso: string) => {
  try {
    return format(parseISO(iso), "dd/MM 'às' HH:mm", { locale: ptBR })
  } catch {
    return iso
  }
}

export const normalizePhone = (raw: string) => {
  let digits = raw.replace(/\D/g, '').replace(/^0+/, '')
  if (digits && !digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`
  }
  return digits
}

export const waLink = (phone: string) => `https://wa.me/${normalizePhone(phone)}`

export const fmtPhone = (raw: string) => {
  const d = normalizePhone(raw)
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 11) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 10) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return raw
}
