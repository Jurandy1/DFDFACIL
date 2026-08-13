/**
 * Cliente para API Compras.gov.br (dados abertos).
 * Swagger: https://dadosabertos.compras.gov.br/swagger-ui/index.html
 */

export const COMPRAS_BASE = 'https://dadosabertos.compras.gov.br'

const PAGE_SIZE = 500
const MAX_PAGES = 3

export type Paginated<T> = {
  resultado?: T[]
  totalRegistros?: number
  totalPaginas?: number
  paginasRestantes?: number
}

export type SiasgPrecoRow = {
  idCompra?: number
  idItemCompra?: number
  idCompraItem?: number
  codigoItemCatalogo?: number
  precoUnitario?: number
  quantidade?: number
  dataResultado?: string
  dataCompra?: string
  codigoUasg?: string | number
  nomeUasg?: string
  nomeOrgao?: string
  estado?: string
  nomeFornecedor?: string
  modalidade?: number
  marca?: string
  objetoCompra?: string
}

export type PncpItemRow = {
  idCompra?: string
  idCompraItem?: string
  codItemCatalogo?: number
  quantidade?: number
  valorUnitarioEstimado?: number
  valorUnitarioResultado?: number
  dataInclusaoPncp?: string
  unidadeOrgaoUfSigla?: string
  orgaoEntidadeCnpj?: string
  descricaoResumida?: string
}

export type UnidadeFornecimentoRow = {
  codigoPdm?: number
  siglaUnidadeFornecimento?: string
  nomeUnidadeFornecimento?: string
  siglaUnidadeMedida?: string | null
  statusUnidadeFornecimentoPdm?: boolean
}

export type NaturezaDespesaRow = {
  codigoPdm?: number
  codigoNaturezaDespesa?: string
  nomeNaturezaDespesa?: string | null
}

export function fmtDateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function last12MonthsRange(): { inicio: string; fim: string } {
  const fim = new Date()
  const ini = new Date()
  ini.setMonth(ini.getMonth() - 12)
  return { inicio: fmtDateISO(ini), fim: fmtDateISO(fim) }
}

async function fetchComprasJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      next: { revalidate: 0 },
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, status: res.status, message: text.slice(0, 200) }
    }
    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'fetch failed'
    return { ok: false, status: 0, message }
  }
}

function buildUrl(path: string, params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  return `${COMPRAS_BASE}${path}?${q.toString()}`
}

async function fetchAllPages<T>(
  buildPageUrl: (pagina: number) => string,
  maxPages = MAX_PAGES
): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = []
  let pagina = 1
  let totalPaginas = 1

  while (pagina <= totalPaginas && pagina <= maxPages) {
    const result = await fetchComprasJson<Paginated<T>>(buildPageUrl(pagina))
    if (!result.ok) {
      return { rows, error: result.message || `HTTP ${result.status}` }
    }
    const batch = result.data.resultado || []
    rows.push(...batch)
    totalPaginas = result.data.totalPaginas ?? pagina
    if (!batch.length) break
    pagina += 1
  }

  return { rows }
}

export function siasgRowKey(row: SiasgPrecoRow): string {
  if (row.idCompraItem != null) return String(row.idCompraItem)
  if (row.idItemCompra != null && row.idCompra != null) {
    return `${row.idCompra}-${row.idItemCompra}`
  }
  return `${row.codigoUasg ?? 'u'}-${row.dataCompra ?? ''}-${row.precoUnitario ?? ''}`
}

export function pncpRowKey(row: PncpItemRow): string {
  return row.idCompraItem || row.idCompra || 'pncp-unknown'
}

export async function fetchSiasgPrecos(codigoItem: number): Promise<{
  rows: SiasgPrecoRow[]
  error?: string
  truncated?: boolean
}> {
  const { inicio, fim } = last12MonthsRange()

  const { rows, error } = await fetchAllPages<SiasgPrecoRow>((pagina) =>
    buildUrl('/modulo-pesquisa-preco/1_consultarMaterial', {
      tipo: 'codigoItemCatalogo',
      codigo: codigoItem,
      pagina,
      tamanhoPagina: PAGE_SIZE,
      dataCompraInicio: inicio,
      dataCompraFim: fim,
    })
  )

  const truncated = rows.length >= PAGE_SIZE * MAX_PAGES
  return { rows, error, truncated }
}

export async function fetchPncpPrecos(codigoItem: number): Promise<{
  rows: Array<PncpItemRow & { preco: number; data: string | null; orgao: string | null; uf: string | null }>
  error?: string
}> {
  const { inicio, fim } = last12MonthsRange()

  const { rows, error } = await fetchAllPages<PncpItemRow>((pagina) =>
    buildUrl('/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133', {
      codItemCatalogo: codigoItem,
      materialOuServico: 'M',
      pagina,
      tamanhoPagina: PAGE_SIZE,
      dataInclusaoPncpInicial: inicio,
      dataInclusaoPncpFinal: fim,
    })
  )

  const mapped = rows
    .map((row) => {
      const preco = Number(row.valorUnitarioResultado || row.valorUnitarioEstimado || 0)
      if (!preco || preco <= 0) return null
      const data =
        (row as { dataInclusaoPncp?: string }).dataInclusaoPncp?.slice(0, 10) ??
        (row as { dataPublicacaoPncp?: string }).dataPublicacaoPncp?.slice(0, 10) ??
        null
      return {
        ...row,
        preco,
        data,
        orgao: row.orgaoEntidadeCnpj ?? null,
        uf: (row as { unidadeOrgaoUfSigla?: string }).unidadeOrgaoUfSigla ?? null,
      }
    })
    .filter(Boolean) as Array<
    PncpItemRow & { preco: number; data: string | null; orgao: string | null; uf: string | null }
  >

  return { rows: mapped, error }
}

export async function fetchUnidadeFornecimentoPdm(codigoPdm: number): Promise<UnidadeFornecimentoRow | null> {
  const url = buildUrl('/modulo-material/6_consultarMaterialUnidadeFornecimento', {
    codigoPdm,
    pagina: 1,
    tamanhoPagina: 10,
    statusUnidadeFornecimentoPdm: 'true',
  })
  const result = await fetchComprasJson<Paginated<UnidadeFornecimentoRow>>(url)
  if (!result.ok) return null
  const row = result.data.resultado?.find((r) => r.statusUnidadeFornecimentoPdm !== false)
  return row ?? result.data.resultado?.[0] ?? null
}

export async function fetchNaturezaDespesaPdm(codigoPdm: number): Promise<NaturezaDespesaRow | null> {
  const url = buildUrl('/modulo-material/5_consultarMaterialNaturezaDespesa', {
    codigoPdm,
    pagina: 1,
    tamanhoPagina: 10,
  })
  const result = await fetchComprasJson<Paginated<NaturezaDespesaRow>>(url)
  if (!result.ok) return null
  return result.data.resultado?.[0] ?? null
}

export async function fetchItemEnrichment(codigoPdm: number): Promise<{
  unidadeFornecimento: UnidadeFornecimentoRow | null
  naturezaDespesa: NaturezaDespesaRow | null
}> {
  const [unidadeFornecimento, naturezaDespesa] = await Promise.all([
    fetchUnidadeFornecimentoPdm(codigoPdm),
    fetchNaturezaDespesaPdm(codigoPdm),
  ])
  return { unidadeFornecimento, naturezaDespesa }
}
