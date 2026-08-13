/** Extrai atributos de strings CATMAT (TIPO: X, TENSÃO: Y, …) para tags na UI */
export function parseCatmatAttributes(descricao: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const re = /,\s*([A-Za-zÀ-ÿ0-9 /-]{2,40}):\s*([^,]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(descricao)) !== null) {
    const rawKey = m[1].trim().toUpperCase()
    const val = m[2].trim()
    let key = 'Outros'
    if (/^TIPO/.test(rawKey)) key = 'Tipo'
    else if (/^MODELO/.test(rawKey)) key = 'Modelo'
    else if (/TENS/.test(rawKey)) key = 'Tensão'
    else if (/CAPACIDADE/.test(rawKey)) key = 'Capacidade'
    else if (/MATERIAL/.test(rawKey)) key = 'Material'
    else if (/COR/.test(rawKey)) key = 'Cor'
    if (!out[key]) out[key] = []
    if (!out[key].includes(val)) out[key].push(val)
  }
  return out
}

export function catmatAttributeTags(descricao: string, limit = 6): string[] {
  const attrs = parseCatmatAttributes(descricao)
  const tags: string[] = []
  for (const key of ['Tipo', 'Modelo', 'Capacidade', 'Tensão', 'Material', 'Cor']) {
    for (const v of attrs[key] || []) {
      tags.push(`${key}: ${v}`)
      if (tags.length >= limit) return tags
    }
  }
  return tags
}
