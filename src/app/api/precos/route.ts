import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchItemEnrichment,
  fetchPncpPrecos,
  fetchSiasgPrecos,
  pncpRowKey,
  siasgRowKey,
} from '@/lib/compras-api'

type CacheRow = {
  codigo_item: number
  fonte: 'siasg' | 'pncp'
  preco_unitario: number
  quantidade: number | null
  data_resultado: string
  uasg_origem: string
  orgao_nome: string | null
  uf: string | null
  raw: unknown
  fetched_at: string
}

function dedupeRows(rows: CacheRow[]): CacheRow[] {
  const map = new Map<string, CacheRow>()
  for (const row of rows) {
    const key = `${row.codigo_item}|${row.fonte}|${row.data_resultado}|${row.uasg_origem}`
    map.set(key, row)
  }
  return [...map.values()]
}

type RecentRow = {
  fonte: string
  preco_unitario: number
  data_resultado: string | null
  orgao_nome: string | null
  uf: string | null
  quantidade: number | null
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

async function fetchAndCachePrices(
  supabase: Awaited<ReturnType<typeof createClient>>,
  codigoItem: number,
  codigoPdm: number
) {
  const meta: Record<string, unknown> = {}

  const [siasgRes, pncpRes, enrichRes] = await Promise.all([
    fetchSiasgPrecos(codigoItem),
    fetchPncpPrecos(codigoItem),
    codigoPdm > 0 ? fetchItemEnrichment(codigoPdm) : Promise.resolve(null),
  ])

  if (siasgRes.error) meta.siasgError = siasgRes.error
  if (pncpRes.error) meta.pncpError = pncpRes.error
  if (siasgRes.truncated) meta.siasgTruncated = true

  if (!siasgRes.rows.length && !pncpRes.rows.length) {
    meta.fetchError =
      siasgRes.error && pncpRes.error
        ? 'API Compras.gov indisponível — preencha manualmente'
        : 'Sem preços nos últimos 12 meses — preencha manualmente'
  }

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
      raw: s,
      fetched_at: new Date().toISOString(),
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
      raw: p,
      fetched_at: new Date().toISOString(),
    })
  }

  const uniqueRows = dedupeRows(rows)
  if (uniqueRows.length) {
    const { error: upsertError } = await supabase.from('preco_cache').upsert(uniqueRows, {
      onConflict: 'codigo_item,fonte,data_resultado,uasg_origem',
    })
    if (upsertError) meta.cacheError = upsertError.message
  }

  if (enrichRes) {
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

  return meta
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

  if (!codigoItem) {
    return NextResponse.json({ error: 'codigoItem obrigatório' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const since = new Date()
  since.setDate(since.getDate() - 30)

  const { data: cached } = await supabase
    .from('preco_cache')
    .select('codigo_item')
    .eq('codigo_item', codigoItem)
    .gte('fetched_at', since.toISOString())

  let needFetch = !cached || cached.length === 0
  const meta: Record<string, unknown> = {}

  if (!needFetch) {
    const { data: quickStats } = await supabase.rpc('stats_preco_item', {
      p_codigo_item: codigoItem,
      p_fonte: null,
    })
    if (!quickStats?.length) needFetch = true
  }

  if (needFetch) {
    Object.assign(meta, await fetchAndCachePrices(supabase, codigoItem, codigoPdm))
  } else if (codigoPdm > 0) {
    const enrichRes = await fetchItemEnrichment(codigoPdm)
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

  const { data: stats, error: statsError } = await supabase.rpc('stats_preco_item', {
    p_codigo_item: codigoItem,
    p_fonte: null,
  })
  if (statsError) meta.statsError = statsError.message

  const { data: recent } = await supabase
    .from('preco_cache')
    .select('fonte,preco_unitario,data_resultado,orgao_nome,uf,quantidade')
    .eq('codigo_item', codigoItem)
    .order('data_resultado', { ascending: false })
    .limit(30)

  const byFonte = (stats || []) as Array<{
    fonte: string
    n: number
    mediana: number
    p25: number
    p75: number
    minimo: number
    maximo: number
  }>
  const siasgStats = byFonte.find((s) => s.fonte === 'siasg')
  const pncpStats = byFonte.find((s) => s.fonte === 'pncp')
  const statsPreferred = siasgStats || pncpStats || null

  let preferredOut: {
    mediana: number
    p25: number
    p75: number
    minimo: number
    maximo: number
    n: number
    fonte: string
    fonteRaw: string
  } | null = null

  if (statsPreferred) {
    preferredOut = {
      mediana: Number(statsPreferred.mediana),
      p25: Number(statsPreferred.p25),
      p75: Number(statsPreferred.p75),
      minimo: Number(statsPreferred.minimo),
      maximo: Number(statsPreferred.maximo),
      n: Number(statsPreferred.n),
      fonte: siasgStats ? 'siasg_mediana_12m' : 'pncp_mediana_12m',
      fonteRaw: statsPreferred.fonte,
    }
  } else if ((recent?.length ?? 0) > 0) {
    const fb = fallbackPreferredFromRecent(recent as RecentRow[])
    if (fb) {
      preferredOut = fb
      meta.preferredFallback = true
    }
  }

  return NextResponse.json({
    codigoItem,
    stats: byFonte,
    preferred: preferredOut,
    recent: recent || [],
    meta: Object.keys(meta).length ? meta : undefined,
    unidadeSugerida: meta.unidadeSugerida ?? undefined,
  })
}
