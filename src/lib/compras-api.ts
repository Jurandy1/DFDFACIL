/**
 * Cliente para API Compras.gov.br (dados abertos).
 * Swagger: https://dadosabertos.compras.gov.br/swagger-ui/index.html
 */

export const COMPRAS_BASE = 'https://dadosabertos.compras.gov.br'

const FULL_PAGE_SIZE = 200
const FULL_MAX_PAGES = 2
const FAST_PAGE_SIZE = 50
const FAST_MAX_PAGES = 1

export type FetchMode = 'fast' | 'full'

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

export type PncpPrecoRow = PncpItemRow & {
  preco: number
  data: string | null
  orgao: string | null
  uf: string | null
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

function pageConfig(mode: FetchMode) {
  return mode === 'fast'
    ? { pageSize: FAST_PAGE_SIZE, maxPages: FAST_MAX_PAGES, siasgMs: 7_000, pncpMs: 0 }
    : { pageSize: FULL_PAGE_SIZE, maxPages: FULL_MAX_PAGES, siasgMs: 25_000, pncpMs: 60_000 }
}

async function fetchComprasJson<T>(
  url: string,
  signal?: AbortSignal
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal,
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, status: res.status, message: text.slice(0, 200) }
    }
    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, status: 0, message: 'abort' }
    }
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
  maxPages: number,
  signal?: AbortSignal
): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = []
  let pagina = 1
  let totalPaginas = 1

  while (pagina <= totalPaginas && pagina <= maxPages) {
    if (signal?.aborted) return { rows, error: 'abort' }
    const result = await fetchComprasJson<Paginated<T>>(buildPageUrl(pagina), signal)
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

function withAbortTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
  }
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

function mapPncpRows(rows: PncpItemRow[]): PncpPrecoRow[] {
  return rows
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
    .filter(Boolean) as PncpPrecoRow[]
}

export async function fetchSiasgPrecos(
  codigoItem: number,
  mode: FetchMode = 'full'
): Promise<{ rows: SiasgPrecoRow[]; error?: string; truncated?: boolean }> {
  const { inicio, fim } = last12MonthsRange()
  const cfg = pageConfig(mode)
  const { signal, clear } = withAbortTimeout(cfg.siasgMs)

  try {
    const { rows, error } = await fetchAllPages<SiasgPrecoRow>(
      (pagina) =>
        buildUrl('/modulo-pesquisa-preco/1_consultarMaterial', {
          tipo: 'codigoItemCatalogo',
          codigo: codigoItem,
          pagina,
          tamanhoPagina: cfg.pageSize,
          dataCompraInicio: inicio,
          dataCompraFim: fim,
        }),
      cfg.maxPages,
      signal
    )
    const truncated = rows.length >= cfg.pageSize * cfg.maxPages
    return { rows, error: error === 'abort' ? 'SIASG timeout' : error, truncated }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'SIASG indisponível'
    return { rows: [], error: message }
  } finally {
    clear()
  }
}

export async function fetchPncpPrecos(
  codigoItem: number,
  mode: FetchMode = 'full'
): Promise<{ rows: PncpPrecoRow[]; error?: string }> {
  if (mode === 'fast') return { rows: [] }

  const { inicio, fim } = last12MonthsRange()
  const cfg = pageConfig(mode)
  const { signal, clear } = withAbortTimeout(cfg.pncpMs)

  try {
    const { rows, error } = await fetchAllPages<PncpItemRow>(
      (pagina) =>
        buildUrl('/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133', {
          codItemCatalogo: codigoItem,
          materialOuServico: 'M',
          pagina,
          tamanhoPagina: cfg.pageSize,
          dataInclusaoPncpInicial: inicio,
          dataInclusaoPncpFinal: fim,
        }),
      cfg.maxPages,
      signal
    )
    return {
      rows: mapPncpRows(rows),
      error: error === 'abort' ? 'PNCP timeout' : error,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'PNCP indisponível'
    return { rows: [], error: message }
  } finally {
    clear()
  }
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
