export type PdmHit = {
  codigo_pdm: number
  nome_pdm: string
  codigo_classe: number
  qtd_itens: number
  score: number
}

export type ItemHit = {
  codigo_item: number
  descricao: string
  unidade: string
  nome_pdm: string
  codigo_classe: number
  codigo_grupo: number
  score: number
}

export type PrecoStats = {
  fonte: string
  n: number
  mediana: number
  p25: number
  p75: number
  minimo: number
  maximo: number
}

export type DemandaItem = {
  id: string
  demanda_id: string
  codigo_item: number
  descricao: string
  unidade: string | null
  quantidade: number
  preco_unitario: number | null
  preco_fonte: string | null
  ordem: number
}

export function formatBRL(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function precoFonteBadge(fonte: string | null | undefined) {
  switch (fonte) {
    case 'siasg_mediana_12m':
      return 'referência SIASG mediana 12m'
    case 'pncp_mediana_12m':
      return 'referência PNCP mediana 12m'
    case 'manual':
      return 'manual'
    default:
      return 'sem preço'
  }
}

export function buildCsv(items: DemandaItem[]) {
  const header = ['Item', 'Código', 'Descrição', 'Unidade', 'Quant.', 'R$ Unid.', 'R$ Total', 'Fonte preço']
  const lines = items.map((it, idx) => {
    const q = Number(it.quantidade || 0)
    const p = Number(it.preco_unitario || 0)
    const total = q * p
    const desc = (it.descricao || '').replaceAll('"', '""')
    return [
      String(idx + 1),
      String(it.codigo_item),
      `"${desc}"`,
      it.unidade || 'unidade',
      String(q).replace('.', ','),
      p.toFixed(2).replace('.', ','),
      total.toFixed(2).replace('.', ','),
      precoFonteBadge(it.preco_fonte),
    ].join(';')
  })
  return [header.join(';'), ...lines].join('\n')
}
