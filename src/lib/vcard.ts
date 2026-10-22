export interface ParsedContact {
  customerName: string
  phone: string
}

export function parseVCard(text: string): ParsedContact[] {
  const out: ParsedContact[] = []
  for (const block of text.split(/BEGIN:VCARD/i).slice(1)) {
    const body = block.split(/END:VCARD/i)[0]
    const fn = body.match(/^FN[^:]*:(.+)$/im)?.[1]?.trim()
    const tel = body.match(/^TEL[^:]*:(.+)$/im)?.[1]?.trim()
    if (fn || tel) out.push({ customerName: fn ?? 'Sem nome', phone: tel ?? '' })
  }
  return out
}

export function parseCsv(text: string): ParsedContact[] {
  const out: ParsedContact[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/[,;]/).map((p) => p.trim().replace(/^"|"$/g, ''))
    if (parts.length < 2) continue
    const [name, phone] = parts
    if (/^(nome|name)$/i.test(name)) continue
    if (phone) out.push({ customerName: name, phone })
  }
  return out
}

export function parseContacts(text: string): ParsedContact[] {
  if (/BEGIN:VCARD/i.test(text)) return parseVCard(text)
  return parseCsv(text)
}
