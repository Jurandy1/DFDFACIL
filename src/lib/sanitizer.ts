/**
 * Sanitizer + intent parser para queries CATMAT (Fase A).
 * Não remove "com"/"sem" como stopword — usa-os para inferir filtros.
 */

export type SearchIntent = {
  /** Texto limpo para FTS / buscar_pdms (sem tokens já virados filtro) */
  termoLimpo: string
  tem_forno: boolean | null
  capacidade_btu: number | null
  qtd_bocas: number | null
}

function stripAccents(s: string) {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Transforma linguagem natural em tokens compatíveis com o CATMAT */
export function sanitizarQueryCATMAT(query: string): string {
  if (!query) return ''

  let q = stripAccents(query.toLowerCase())

  // Números por extenso / abreviação
  q = q.replace(/(\d+)\s*mil\b/g, (_, n) => `${n}000`)
  q = q.replace(/(\d+)\s*k\b/g, (_, n) => `${n}000`)

  // 9.000 → 9000
  q = q.replace(/(\d+)\.(\d{3})\b/g, '$1$2')

  // Unidades e plurais comuns
  q = q.replace(/\bcondicionados?\b/g, 'condicionado')
  q = q.replace(/\bbtus?\b|\bbtu\/h\b/g, 'btu')
  q = q.replace(/\bqueimadores?\b/g, 'bocas')
  q = q.replace(/\bbocas?\b/g, 'bocas')
  q = q.replace(/\bfogoes\b/g, 'fogao')

  // Stopwords leves — NÃO inclui com/sem
  q = q.replace(/\b(de|da|do|das|dos|para|em|um|uma|o|a|os|as)\b/g, ' ')

  return q.trim().replace(/\s+/g, ' ')
}

/**
 * Extrai filtros estruturados e devolve termo residual para FTS.
 * Ex.: "fogão industrial 4 bocas com forno"
 *   → termoLimpo: "fogao industrial", tem_forno: true, qtd_bocas: 4
 */
export function parseSearchIntent(query: string): SearchIntent {
  const original = stripAccents(query.toLowerCase())
  let q = sanitizarQueryCATMAT(query)

  let tem_forno: boolean | null = null
  if (/\bsem\s+forno\b/.test(original)) tem_forno = false
  else if (/\bcom\s+forno\b/.test(original)) tem_forno = true

  if (tem_forno !== null) {
    q = q.replace(/\b(com|sem)\s+forno\b/g, ' ')
    q = q.replace(/\bforno\b/g, ' ')
  }

  let capacidade_btu: number | null = null
  const btu = q.match(/(\d{4,6})\s*btu\b/)
  if (btu) {
    capacidade_btu = parseInt(btu[1], 10)
    q = q.replace(/\d{4,6}\s*btu\b/g, ' ')
  }

  let qtd_bocas: number | null = null
  const bocas = q.match(/(\d+)\s*bocas\b/)
  if (bocas) {
    qtd_bocas = parseInt(bocas[1], 10)
    q = q.replace(/\d+\s*bocas\b/g, ' ')
  }

  q = q.replace(/\b(com|sem)\b/g, ' ').trim().replace(/\s+/g, ' ')

  return {
    termoLimpo: q,
    tem_forno,
    capacidade_btu: Number.isFinite(capacidade_btu as number) ? capacidade_btu : null,
    qtd_bocas: Number.isFinite(qtd_bocas as number) ? qtd_bocas : null,
  }
}

/** Converte facetas ativas da UI em filtros tipados */
export function filtersFromFacets(facets: Record<string, string>): {
  tem_forno: boolean | null
  capacidade_btu: number | null
  qtd_bocas: number | null
} {
  let tem_forno: boolean | null = null
  let capacidade_btu: number | null = null
  let qtd_bocas: number | null = null

  const forno = facets.FORNO
  if (forno === 'COM FORNO') tem_forno = true
  else if (forno === 'SEM FORNO') tem_forno = false

  const cap = facets.CAPACIDADE
  if (cap) {
    const n = parseInt(cap.replace(/[^\d]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) capacidade_btu = n
  }

  const boc = facets.BOCAS
  if (boc) {
    const n = parseInt(boc.replace(/[^\d]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) qtd_bocas = n
  }

  return { tem_forno, capacidade_btu, qtd_bocas }
}

/** Merge intent + facetas (faceta tem prioridade) */
export function mergeFilters(
  intent: SearchIntent,
  facets: Record<string, string>
): SearchIntent {
  const fromFacet = filtersFromFacets(facets)
  return {
    termoLimpo: intent.termoLimpo,
    tem_forno: fromFacet.tem_forno ?? intent.tem_forno,
    capacidade_btu: fromFacet.capacidade_btu ?? intent.capacidade_btu,
    qtd_bocas: fromFacet.qtd_bocas ?? intent.qtd_bocas,
  }
}
