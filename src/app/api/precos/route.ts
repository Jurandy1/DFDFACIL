import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchItemEnrichment,
  fetchPncpPrecos,
  fetchSiasgPrecos,
  pncpRowKey,
  siasgRowKey,
  type FetchMode,
  type PncpPrecoRow,
} from '@/lib/compras-api'

export const maxDuration = 10
const REQUEST_BUDGET_MS = 8_000
const STALE_DAYS = 30
const UPSERT_BATCH = 50

type CacheRow = {
  codigo_item: number
  fonte: 'siasg' | 'pncp'
  preco_unitario: number
  quantidade: number | null
  data_resultado: string
  uasg_origem: string
  orgao_nome: string | null
  uf: string | null
  fetched_at: string
}

type RecentRow = {
  fonte: string
  preco_unitario: number
  data_resultado: string | null
  orgao_nome: string | null
  uf: string | null
  quantidade: number | null
}

type StatsRow = {
  fonte: string
  n: number
  mediana: number
  p25: number
  p75: number
  minimo: number
  maximo: number
}

function dedupeRows(rows: CacheRow[]): CacheRow[] {
  const map = new Map<string, CacheRow>()
  for (const row of rows) {
    const key = `${row.codigo_item}|${row.fonte}|${row.data_resultado}|${row.uasg_origem}`
    map.set(key, row)
  }
  return [...map.values()]
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function fallbackPreferredFromRecent(recent: RecentRow[]) {
  const siasg = recent
    .filter((r) => r.fonte === 'siasg')
    .map((r) => Number(r.preco_unitario))
    .filter((p) => p > 0)
  const pncp = recent
    .filter((r) => r.fonte === 'pncp')
    .map((r) => Number(r.preco_unitario))
    .filter((p) => p > 0)
  const prices = siasg.length ? siasg : pncp
  if (!prices.length) return null
  const sorted = [...prices].sort((a, b) => a - b)
  return {
    mediana: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    minimo: sorted[0],
    maximo: sorted[sorted.length - 1],
    n: sorted.length,
    fonte: siasg.length ? 'siasg_mediana_12m' : 'pncp_mediana_12m',
    fonteRaw: siasg.length ? 'siasg' : 'pncp',
  }
}

function applyEnrichment(
  meta: Record<string, unknown>,
  enrichRes: Awaited<ReturnType<typeof fetchItemEnrichment>>
) {
  meta.enrichment = {
    unidadeFornecimento: enrichRes.unidadeFornecimento
      ? {
          sigla: enrichRes.unidadeFornecimento.siglaUnidadeFornecimento,
          nome: enrichRes.unidadeFornecimento.nomeUnidadeFornecimento,
        }
      : null,
    naturezaDespesa: enrichRes.naturezaDespesa?.codigoNaturezaDespesa
      ? {
          codigo: enrichRes.naturezaDespesa.codigoNaturezaDespesa,
          nome: enrichRes.naturezaDespesa.nomeNaturezaDespesa,
        }
      : null,
  }
  if (enrichRes.unidadeFornecimento?.nomeUnidadeFornecimento) {
    meta.unidadeSugerida = enrichRes.unidadeFornecimento.nomeUnidadeFornecimento.toLowerCase()
  }
}

async function upsertBatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: CacheRow[]
): Promise<string | undefined> {
  if (!rows.length) return undefined
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    const { error } = await supabase.from('preco_cache').upsert(batch, {
      onConflict: 'codigo_item,fonte,data_resultado,uasg_origem',
    })
    if (error) return error.message
  }
  return undefined
}

function rowsFromGov(
  codigoItem: number,
  siasgRes: Awaited<ReturnType<typeof fetchSiasgPrecos>>,
  pncpRes: Awaited<ReturnType<typeof fetchPncpPrecos>>
): CacheRow[] {
  const now = new Date().toISOString()
  const rows: CacheRow[] = []

  for (const s of siasgRes.rows) {
    const preco = Number(s.precoUnitario)
    if (!preco || preco <= 0) continue
    const data =
      (s.dataResultado || s.dataCompra || '').toString().slice(0, 10) ||
      new Date().toISOString().slice(0, 10)
    rows.push({
      codigo_item: codigoItem,
      fonte: 'siasg',
      preco_unitario: preco,
      quantidade: s.quantidade ?? null,
      data_resultado: data,
      uasg_origem: siasgRowKey(s),
      orgao_nome: s.nomeUasg || s.nomeOrgao || null,
      uf: s.estado ?? null,
      fetched_at: now,
    })
  }

  for (const p of pncpRes.rows) {
    rows.push({
      codigo_item: codigoItem,
      fonte: 'pncp',
      preco_unitario: p.preco,
      quantidade: p.quantidade ?? null,
      data_resultado: p.data || new Date().toISOString().slice(0, 10),
      uasg_origem: pncpRowKey(p),
      orgao_nome: p.orgao,
      uf: p.uf,
      fetched_at: now,
    })
  }

  return dedupeRows(rows)
}

async function fetchAndCachePrices(
  supabase: Awaited<ReturnType<typeof createClient>>,
  codigoItem: number,
  codigoPdm: number,
  mode: FetchMode
) {
  const meta: Record<string, unknown> = {}
  const includePncp = mode === 'full'
  const includeEnrichment = mode === 'full' && codigoPdm > 0

  const [siasgRes, pncpRes, enrichRes] = await Promise.all([
    fetchSiasgPrecos(codigoItem, mode),
    includePncp ? fetchPncpPrecos(codigoItem, mode) : Promise.resolve({ rows: [] as PncpPrecoRow[], error: undefined }),
    includeEnrichment ? fetchItemEnrichment(codigoPdm) : Promise.resolve(null),
  ])

  if (siasgRes.error) meta.siasgError = siasgRes.error
  if (pncpRes.error) meta.pncpError = pncpRes.error
  if (siasgRes.truncated) meta.siasgTruncated = true

  const uniqueRows = rowsFromGov(codigoItem, siasgRes, pncpRes)
  if (!uniqueRows.length) {
    meta.fetchError =
      siasgRes.error && pncpRes.error
        ? 'API Compras.gov indisponível — preencha manualmente'
        : 'Sem preços nos últimos 12 meses — preencha manualmente'
  } else {
    const cacheError = await upsertBatches(supabase, uniqueRows)
    if (cacheError) meta.cacheError = cacheError
  }

  if (enrichRes) {
    try {
      applyEnrichment(meta, enrichRes)
    } catch {
      meta.enrichmentError = 'Falha ao enriquecer item'
    }
  }

  return meta
}

async function loadCacheData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  codigoItem: number
) {
  const [recentRes, statsRes, freshRes] = await Promise.all([
    supabase
      .from('preco_cache')
      .select('fonte,preco_unitario,data_resultado,orgao_nome,uf,quantidade')
      .eq('codigo_item', codigoItem)
      .order('data_resultado', { ascending: false })
      .limit(30),
    supabase.rpc('stats_preco_item', { p_codigo_item: codigoItem, p_fonte: null }),
    supabase
      .from('preco_cache')
      .select('fetched_at')
      .eq('codigo_item', codigoItem)
      .order('fetched_at', { ascending: false })
      .limit(1),
  ])

  return {
    recent: recentRes.data || [],
    stats: (statsRes.data || []) as StatsRow[],
    statsError: statsRes.error?.message,
    latestFetch: freshRes.data?.[0]?.fetched_at as string | undefined,
  }
}

function isStale(latestFetch: string | undefined): boolean {
  if (!latestFetch) return true
  const since = new Date()
  since.setDate(since.getDate() - STALE_DAYS)
  return new Date(latestFetch) < since
}

function buildPreferred(stats: StatsRow[], recent: RecentRow[]) {
  const siasgStats = stats.find((s) => s.fonte === 'siasg')
  const pncpStats = stats.find((s) => s.fonte === 'pncp')
  const statsPreferred = siasgStats || pncpStats || null

  if (statsPreferred) {
    return {
      mediana: Number(statsPreferred.mediana),
      p25: Number(statsPreferred.p25),
      p75: Number(statsPreferred.p75),
      minimo: Number(statsPreferred.minimo),
      maximo: Number(statsPreferred.maximo),
      n: Number(statsPreferred.n),
      fonte: siasgStats ? 'siasg_mediana_12m' : 'pncp_mediana_12m',
      fonteRaw: statsPreferred.fonte,
    }
  }

  if (recent.length) {
    const fb = fallbackPreferredFromRecent(recent)
    if (fb) return { ...fb, preferredFallback: true as const }
  }

  return null
}

async function refreshInBackground(codigoItem: number, codigoPdm: number) {
  try {
    const supabase = await createClient()
    await fetchAndCachePrices(supabase, codigoItem, codigoPdm, 'full')
  } catch (e) {
    console.error('[api/precos] background refresh failed', codigoItem, e)
  }
}

export async function GET(req: NextRequest) {
  try {
    return await handlePrecos(req)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno ao buscar preços'
    console.error('[api/precos]', e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function handlePrecos(req: NextRequest) {
  const codigoItem = Number(req.nextUrl.searchParams.get('codigoItem'))
  const codigoPdm = Number(req.nextUrl.searchParams.get('codigoPdm') || 0)
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'

  if (!codigoItem) {
    return NextResponse.json({ error: 'codigoItem obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const meta: Record<string, unknown> = {}
  let { recent, stats, statsError, latestFetch } = await loadCacheData(supabase, codigoItem)
  if (statsError) meta.statsError = statsError

  const hasCache = recent.length > 0
  const stale = isStale(latestFetch)
  const started = Date.now()

  const scheduleBackground = () => {
    after(() => refreshInBackground(codigoItem, codigoPdm))
    meta.refreshScheduled = true
  }

  if (hasCache && !forceRefresh && !stale) {
    if (codigoPdm > 0) {
      try {
        applyEnrichment(meta, await fetchItemEnrichment(codigoPdm))
      } catch {
        meta.enrichmentError = 'Falha ao enriquecer item'
      }
    }
  } else if (hasCache && !forceRefresh && stale) {
    meta.stale = true
    scheduleBackground()
  } else {
    const remaining = () => REQUEST_BUDGET_MS - (Date.now() - started)
    if (remaining() > 500) {
      try {
        const fetchMeta = await fetchAndCachePrices(supabase, codigoItem, codigoPdm, 'fast')
        Object.assign(meta, fetchMeta)
        if (fetchMeta.siasgError || fetchMeta.pncpError) meta.partial = true
        const refreshed = await loadCacheData(supabase, codigoItem)
        recent = refreshed.recent
        stats = refreshed.stats
        if (refreshed.statsError) meta.statsError = refreshed.statsError
      } catch {
        meta.fetchError = hasCache
          ? 'Atualização parcial — exibindo cache'
          : 'Falha na consulta rápida — preencha manualmente'
      }
    }
    scheduleBackground()
  }

  if (forceRefresh) {
    meta.refreshRequested = true
    scheduleBackground()
  }

  const preferredResult = buildPreferred(stats, recent as RecentRow[])
  const preferredOut = preferredResult
    ? {
        mediana: preferredResult.mediana,
        p25: preferredResult.p25,
        p75: preferredResult.p75,
        minimo: preferredResult.minimo,
        maximo: preferredResult.maximo,
        n: preferredResult.n,
        fonte: preferredResult.fonte,
        fonteRaw: preferredResult.fonteRaw,
      }
    : null

  if (preferredResult && 'preferredFallback' in preferredResult) {
    meta.preferredFallback = true
  }

  return NextResponse.json({
    codigoItem,
    stats,
    preferred: preferredOut,
    recent,
    meta: Object.keys(meta).length ? meta : undefined,
    unidadeSugerida: meta.unidadeSugerida ?? undefined,
  })
}
