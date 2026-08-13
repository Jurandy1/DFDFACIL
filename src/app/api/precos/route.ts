import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type SiasgRow = {
  precoUnitario?: number
  quantidade?: number
  dataResultado?: string
  dataCompra?: string
  codigoUasg?: string | number
  nomeUasg?: string
  estado?: string
}

async function fetchSiasg(codigoItem: number) {
  const url =
    `https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial` +
    `?codigoItemCatalogo=${codigoItem}&pagina=1&tamanhoPagina=500`
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    next: { revalidate: 0 },
  })
  if (!res.ok) return [] as SiasgRow[]
  const data = await res.json()
  return (data.resultado || []) as SiasgRow[]
}

async function fetchPncpHeuristic(codigoItem: number) {
  // PNCP não tem filtro direto por CATMAT em todos os endpoints públicos.
  // Tentamos consultar contratações recentes e filtrar itens cujo descrição/código case.
  // Fallback: retorna [] se não houver match — o painel ainda usa SIASG.
  try {
    const hoje = new Date()
    const ini = new Date(hoje)
    ini.setMonth(ini.getMonth() - 12)
    const fmt = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

    // Pregão eletrônico = 6 (amostra); se falhar, ignora
    const url =
      `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao` +
      `?dataInicial=${fmt(ini)}&dataFinal=${fmt(hoje)}&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=20`
    const res = await fetch(url, { headers: { accept: 'application/json' }, next: { revalidate: 0 } })
    if (!res.ok) return [] as Array<Record<string, unknown>>

    const data = await res.json()
    const compras = data.data || data.resultado || []
    const prices: Array<{
      preco: number
      data: string | null
      orgao: string | null
      uf: string | null
      raw: unknown
    }> = []

    for (const c of compras.slice(0, 8)) {
      const orgaoCnpj = c.orgao_cnpj || c.cnpjOrgao || c.cnpj
      const ano = c.anoCompra || c.ano
      const seq = c.sequencialCompra || c.sequencial
      if (!orgaoCnpj || !ano || !seq) continue
      const itensUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${orgaoCnpj}/compras/${ano}/${seq}/itens`
      try {
        const ir = await fetch(itensUrl, { headers: { accept: 'application/json' }, next: { revalidate: 0 } })
        if (!ir.ok) continue
        const itens = await ir.json()
        const list = Array.isArray(itens) ? itens : itens.data || []
        for (const it of list) {
          const catmat = Number(it.codigoItem || it.codigoCatalogo || it.catalogo || 0)
          const desc = String(it.descricao || it.descricaoItem || '')
          if (catmat === codigoItem || desc.includes(String(codigoItem))) {
            const preco = Number(it.valorUnitarioEstimado || it.valorUnitario || it.precoUnitario || 0)
            if (preco > 0) {
              prices.push({
                preco,
                data: c.dataPublicacaoPncp || c.dataPublicacao || null,
                orgao: c.orgao_nome || c.nomeOrgao || null,
                uf: c.uf || c.ufNome || null,
                raw: it,
              })
            }
          }
        }
      } catch {
        /* ignore per-compra errors */
      }
    }
    return prices
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const codigoItem = Number(req.nextUrl.searchParams.get('codigoItem'))
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
    .select('*')
    .eq('codigo_item', codigoItem)
    .gte('fetched_at', since.toISOString())

  const needFetch = !cached || cached.length === 0

  if (needFetch) {
    const [siasg, pncp] = await Promise.all([fetchSiasg(codigoItem), fetchPncpHeuristic(codigoItem)])

    const rows: Array<Record<string, unknown>> = []
    for (const s of siasg) {
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
        uasg_origem: String(s.codigoUasg ?? ''),
        orgao_nome: s.nomeUasg ?? null,
        uf: s.estado ?? null,
        raw: s,
        fetched_at: new Date().toISOString(),
      })
    }
    for (const p of pncp) {
      rows.push({
        codigo_item: codigoItem,
        fonte: 'pncp',
        preco_unitario: p.preco,
        quantidade: null,
        data_resultado: (p.data || new Date().toISOString()).toString().slice(0, 10),
        uasg_origem: p.orgao || 'pncp',
        orgao_nome: p.orgao,
        uf: p.uf,
        raw: p.raw,
        fetched_at: new Date().toISOString(),
      })
    }

    if (rows.length) {
      await supabase.from('preco_cache').upsert(rows, {
        onConflict: 'codigo_item,fonte,data_resultado,uasg_origem',
      })
    }
  }

  const { data: stats } = await supabase.rpc('stats_preco_item', {
    p_codigo_item: codigoItem,
    p_fonte: null,
  })

  const { data: recent } = await supabase
    .from('preco_cache')
    .select('fonte,preco_unitario,data_resultado,orgao_nome,uf,quantidade')
    .eq('codigo_item', codigoItem)
    .order('data_resultado', { ascending: false })
    .limit(30)

  // Preferência: mediana SIASG, senão PNCP
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
  const preferred = siasgStats || pncpStats || null
  const preferredFonte = siasgStats
    ? 'siasg_mediana_12m'
    : pncpStats
      ? 'pncp_mediana_12m'
      : null

  return NextResponse.json({
    codigoItem,
    stats: byFonte,
    preferred: preferred
      ? {
          mediana: Number(preferred.mediana),
          p25: Number(preferred.p25),
          p75: Number(preferred.p75),
          minimo: Number(preferred.minimo),
          maximo: Number(preferred.maximo),
          n: Number(preferred.n),
          fonte: preferredFonte,
          fonteRaw: preferred.fonte,
        }
      : null,
    recent: recent || [],
  })
}
