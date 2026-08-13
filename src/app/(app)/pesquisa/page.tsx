'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useDemanda } from '@/lib/DemandaProvider'
import {
  formatBRL,
  precoFonteBadge,
  type ItemHit,
  type PdmHit,
  type RecentPrecoRow,
} from '@/lib/types'
import { catmatAttributeTags } from '@/lib/catmat-parse'

type PreferredPrice = {
  mediana: number
  p25: number
  p75: number
  minimo: number
  maximo: number
  n: number
  fonte: string
}

type ItemEnrichment = {
  unidadeFornecimento: { sigla?: string; nome?: string } | null
  naturezaDespesa: { codigo?: string; nome?: string | null } | null
}

type FreeItem = ItemHit & { codigo_pdm: number }

type Faceta = { chave: string; valor: string; qtd: number }

export default function PesquisaPage() {
  const { supabase, demanda, itens, setStatus, status, reload } = useDemanda()

  const [termo, setTermo] = useState('')
  const [pdms, setPdms] = useState<PdmHit[]>([])
  const [freeItems, setFreeItems] = useState<FreeItem[]>([])
  const [pdmSel, setPdmSel] = useState<PdmHit | null>(null)
  const [itemHits, setItemHits] = useState<ItemHit[]>([])
  const [itemFilter, setItemFilter] = useState('')
  const [facetActive, setFacetActive] = useState<Record<string, string>>({})
  const [facetas, setFacetas] = useState<Faceta[]>([])
  const [itemSel, setItemSel] = useState<ItemHit | null>(null)
  const [unidadeSug, setUnidadeSug] = useState('unidade')
  const [qtd, setQtd] = useState(1)
  const [preco, setPreco] = useState<number | null>(null)
  const [precoFonte, setPrecoFonte] = useState<string | null>(null)
  const [preferred, setPreferred] = useState<PreferredPrice | null>(null)
  const [recentPrecos, setRecentPrecos] = useState<RecentPrecoRow[]>([])
  const [enrichment, setEnrichment] = useState<ItemEnrichment | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [priceStale, setPriceStale] = useState(false)
  const [searching, setSearching] = useState(false)
  const [autoOpenedFor, setAutoOpenedFor] = useState('')

  const priceFetchRef = useRef<{ id: number; ctrl: AbortController | null }>({ id: 0, ctrl: null })
  const searchAbortRef = useRef<AbortController | null>(null)

  const filteredItemHits = itemHits

  function buildFilterFromFacets(next: Record<string, string>) {
    return Object.values(next)
      .map((v) => v.replace(/\./g, '').trim())
      .filter(Boolean)
      .join(' ')
  }

  useEffect(() => {
    if (termo.trim().length < 2 && !/^\d{4,}/.test(termo.trim())) {
      setPdms([])
      setFreeItems([])
      return
    }

    const q = termo.trim()
    const codePrefix = q.match(/^(\d{4,})\b/)?.[1] ?? null

    const timer = setTimeout(async () => {
      searchAbortRef.current?.abort()
      const ctrl = new AbortController()
      searchAbortRef.current = ctrl
      setSearching(true)

      try {
        if (codePrefix) {
          const byCode = await supabase.rpc('buscar_itens_livre', { termo: q, lim: 8 })
          if (ctrl.signal.aborted) return
          if (!byCode.error) {
            setFreeItems((byCode.data || []) as FreeItem[])
            setPdms([])
          }
          return
        }

        const [pdmRes, itemRes] = await Promise.all([
          supabase.rpc('buscar_pdms', { termo: q, lim: 18 }),
          supabase.rpc('buscar_itens_livre', { termo: q, lim: 12 }),
        ])
        if (ctrl.signal.aborted) return
        if (pdmRes.error) setStatus(pdmRes.error.message)
        else setPdms((pdmRes.data || []) as PdmHit[])
        if (!itemRes.error) setFreeItems((itemRes.data || []) as FreeItem[])
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, 150)

    return () => {
      clearTimeout(timer)
      searchAbortRef.current?.abort()
    }
  }, [termo, supabase, setStatus])

  // Auto-abre o melhor PDM quando a busca é clara
  useEffect(() => {
    if (searching || !pdms.length) return
    const q = termo.trim().toLowerCase()
    if (!q || /^\d{4,}/.test(q)) return
    if (autoOpenedFor === q) return
    const top = pdms[0]
    const second = pdms[1]
    const clearWinner =
      top.qtd_itens >= 10 &&
      (!second || top.score >= (second.score ?? 0) + 3 || top.qtd_itens >= (second.qtd_itens ?? 0) * 3)
    if (clearWinner) {
      setAutoOpenedFor(q)
      void openPdm(top, { keepTermAsHint: q.split(/\s+/).length > 2 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openPdm estável o suficiente; evita loop
  }, [pdms, searching, termo, autoOpenedFor])

  // Filtro dentro do PDM no servidor
  useEffect(() => {
    if (!pdmSel) return
    const f = itemFilter.trim()
    const t = setTimeout(async () => {
      const { data: items } = await supabase.rpc('buscar_itens_no_pdm', {
        pdm: pdmSel.codigo_pdm,
        termo: f || null,
        lim: f ? 100 : 80,
      })
      setItemHits((items || []) as ItemHit[])
    }, 180)
    return () => clearTimeout(t)
  }, [itemFilter, pdmSel, supabase])

  async function openPdm(p: PdmHit, opts?: { keepTermAsHint?: boolean }) {
    setPdmSel(p)
    setItemSel(null)
    setPreferred(null)
    setPreco(null)
    setPrecoFonte(null)
    setFacetActive({})
    setFacetas([])
    const hint =
      opts?.keepTermAsHint && termo.trim().split(/\s+/).length > 2
        ? termo
            .trim()
            .split(/\s+/)
            .filter((w) => w.length >= 3 && !/^(ar|condicionado|aparelho)$/i.test(w))
            .join(' ')
        : ''
    setItemFilter(hint)
    setItemHits([])
    setStatus(`Abrindo ${p.nome_pdm}…`)
    const [{ data: items }, { data: unid }] = await Promise.all([
      supabase.rpc('buscar_itens_no_pdm', {
        pdm: p.codigo_pdm,
        termo: hint || null,
        lim: hint ? 100 : 80,
      }),
      supabase.rpc('sugerir_unidade', { p_codigo_pdm: p.codigo_pdm }),
    ])
    setItemHits((items || []) as ItemHit[])
    setUnidadeSug((unid as string) || 'unidade')
    setStatus(
      `${(items || []).length} opções em ${p.nome_pdm} — use Tipo / Modelo / Capacidade abaixo`
    )

    window.setTimeout(async () => {
      const { data: fac } = await supabase.rpc('facetas_pdm', {
        pdm: p.codigo_pdm,
        lim_por_chave: 14,
      })
      setFacetas((fac || []) as Faceta[])
    }, 100)
  }

  function toggleFacet(chave: string, valor: string) {
    setFacetActive((prev) => {
      const next = { ...prev }
      if (next[chave] === valor) delete next[chave]
      else next[chave] = valor
      setItemFilter(buildFilterFromFacets(next))
      return next
    })
  }

  async function loadPrecos(
    codigoItem: number,
    codigoPdm: number | undefined,
    opts?: { refresh?: boolean }
  ) {
    priceFetchRef.current.ctrl?.abort()
    const reqId = ++priceFetchRef.current.id
    const ctrl = new AbortController()
    priceFetchRef.current.ctrl = ctrl

    const qs = new URLSearchParams({ codigoItem: String(codigoItem) })
    if (codigoPdm) qs.set('codigoPdm', String(codigoPdm))
    if (opts?.refresh) qs.set('refresh', '1')

    const timer = setTimeout(() => ctrl.abort(), 55_000)
    try {
      const res = await fetch(`/api/precos?${qs.toString()}`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (reqId !== priceFetchRef.current.id) return

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('Sessão expirada — faça login novamente')
      }

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Falha nos preços')

      const pref = json.preferred as PreferredPrice | null
      setPreferred(pref)
      setRecentPrecos((json.recent || []) as RecentPrecoRow[])
      setEnrichment((json.meta?.enrichment as ItemEnrichment) ?? null)
      setPriceStale(Boolean(json.meta?.stale || json.meta?.refreshScheduled))

      if (pref) {
        setPreco(Number(pref.mediana))
        setPrecoFonte(pref.fonte)
        setStatus(`Preço ok · mediana ${formatBRL(pref.mediana)}`)
      } else {
        setPreco(null)
        setPrecoFonte(null)
        const hint = json.meta?.fetchError
          ? String(json.meta.fetchError)
          : json.meta?.refreshScheduled
            ? 'Consulta em andamento — tente Atualizar preço em instantes'
            : 'Sem preços encontrados — preencha manualmente'
        setStatus(hint)
      }
      if (json.unidadeSugerida) setUnidadeSug(String(json.unidadeSugerida))
    } catch (e) {
      clearTimeout(timer)
      if (reqId !== priceFetchRef.current.id) return

      if (e instanceof Error && e.name === 'AbortError') {
        setStatus('Consulta interrompida — clique em Atualizar preço')
        return
      }

      const msg = e instanceof Error ? e.message : 'Erro ao buscar preços'
      setStatus(msg)
    } finally {
      if (reqId === priceFetchRef.current.id) setPriceLoading(false)
    }
  }

  async function openItem(it: ItemHit) {
    setItemSel(it)
    setQtd(1)
    setPreferred(null)
    setRecentPrecos([])
    setEnrichment(null)
    setPreco(null)
    setPrecoFonte(null)
    setPriceStale(false)
    setPriceLoading(true)
    setStatus('Buscando preços…')
    await loadPrecos(it.codigo_item, it.codigo_pdm ?? pdmSel?.codigo_pdm)
  }

  async function refreshPrecos() {
    if (!itemSel) return
    setPriceLoading(true)
    setStatus('Atualizando preços…')
    await loadPrecos(itemSel.codigo_item, itemSel.codigo_pdm ?? pdmSel?.codigo_pdm, {
      refresh: true,
    })
  }

  async function addItem() {
    if (!demanda || !itemSel) return
    const fonte =
      preferred && preco != null && Math.abs(preco - preferred.mediana) < 0.0001
        ? preferred.fonte
        : preco != null
          ? 'manual'
          : null

    const { error } = await supabase.from('demanda_itens').upsert(
      {
        demanda_id: demanda.id,
        codigo_item: itemSel.codigo_item,
        descricao: itemSel.descricao,
        unidade: itemSel.unidade || unidadeSug || 'unidade',
        quantidade: qtd,
        preco_unitario: preco,
        preco_fonte: fonte || precoFonte,
        ordem: itens.length + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'demanda_id,codigo_item' }
    )
    if (error) {
      setStatus(error.message)
      return
    }
    await supabase
      .from('demandas')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', demanda.id)
    setStatus('Adicionado à lista')
    await reload()
  }

  const showResults = termo.trim().length >= 2
  const resultCount = itemSel ? 1 : pdmSel ? filteredItemHits.length : freeItems.length + pdms.length

  function quickSearch(q: string) {
    setTermo(q)
    setPdmSel(null)
    setItemHits([])
    setItemSel(null)
    setFacetas([])
    setFacetActive({})
    setAutoOpenedFor('')
  }

  return (
    <main className="gov-main">
      <div className="hero-banner">
        <div className="hero-top">
          <div>
            <h2>Catálogo de Material (CATMAT / PDM)</h2>
            <p>Consulte itens homologados pelo Governo Federal para instrução do seu DFD.</p>
          </div>
          <span className="hero-badge">dadosabertos.compras.gov.br</span>
        </div>
        <div className="hero-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ marginLeft: 8, flexShrink: 0 }} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            placeholder="Digite o nome do item, código CATMAT ou PDM (Ex: ar condicionado, 621109, cadeira…)"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value)
              setPdmSel(null)
              setItemHits([])
              setItemSel(null)
              setFacetas([])
              setFacetActive({})
              setAutoOpenedFor('')
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn primary"
            style={{ borderRadius: '0.375rem', padding: '0.55rem 1.1rem' }}
            disabled={searching}
          >
            {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        <div className="hero-quick">
          <span>Consultas frequentes:</span>
          {['ar condicionado', 'cadeira escritorio', 'notebook', 'papel a4'].map((q) => (
            <button key={q} type="button" onClick={() => quickSearch(q)}>
              {q.replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      <div className="status-row">
        <span className="chip accent"><span className="dot" />{status}</span>
        {searching && <span className="chip">Consultando base local…</span>}
        {!searching && showResults && (
          <>
            <span className="chip">{pdms.length} PDMs</span>
            <span className="chip">{freeItems.length} itens diretos</span>
            {pdmSel && <span className="chip filter-on">{pdmSel.nome_pdm}</span>}
          </>
        )}
        <Link href="/" className="btn" style={{ marginLeft: 'auto' }}>
          Ver lista ({itens.length})
        </Link>
      </div>

      {!showResults ? (
        <div className="panel">
          <div className="panel-bd">
            <div className="empty">
              <div className="empty-ico">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <div className="empty-title">Comece a pesquisar</div>
              <div>Digite pelo menos 2 letras ou um código CATMAT para buscar na base local (~248k itens).</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="gov-grid">
          <aside className="gov-sidebar">
            <div className="panel">
              <div className="panel-hd">
                <div className="title">
                  <strong>Filtros aplicados</strong>
                  <small>PDMs e atributos extraídos das descrições</small>
                </div>
                {!!Object.keys(facetActive).length && (
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                    onClick={() => {
                      setFacetActive({})
                      setItemFilter('')
                    }}
                  >
                    Limpar
                  </button>
                )}
              </div>
              <div className="panel-bd stack-sm">
                {Object.keys(facetActive).length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(facetActive).map(([k, v]) => (
                      <button
                        key={k}
                        type="button"
                        className="chip accent tag"
                        onClick={() => toggleFacet(k, v)}
                      >
                        {k}: {v} ×
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="muted" style={{ fontSize: '0.78rem' }}>Nenhum filtro selecionado</span>
                )}

                <div className="filter-section-title">Grupos e PDMs</div>
                <div className="scroll-area custom-scrollbar option-list" style={{ maxHeight: 220 }}>
                  {pdms.map((p) => (
                    <button
                      key={p.codigo_pdm}
                      type="button"
                      className={`option ${pdmSel?.codigo_pdm === p.codigo_pdm ? 'active' : ''}`}
                      onClick={() => openPdm(p)}
                    >
                      <div className="title-line">
                        <span className="title">{p.nome_pdm}</span>
                        <span className="chip">{p.qtd_itens}</span>
                      </div>
                      <span className="meta">PDM {p.codigo_pdm}</span>
                    </button>
                  ))}
                  {!pdms.length && !searching && (
                    <div className="muted" style={{ fontSize: '0.78rem', padding: '0.5rem' }}>Nenhum PDM para este termo.</div>
                  )}
                </div>

                {!!facetas.length && (
                  <>
                    <div className="filter-section-title" style={{ marginTop: '0.5rem' }}>
                      Atributos especificados
                      <span className="muted" style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6 }}>· extração automática</span>
                    </div>
                    {(['TIPO', 'MODELO', 'CAPACIDADE', 'TENSÃO', 'CARACTERÍSTICAS'] as const).map((chave) => {
                      const opts = facetas.filter((f) => f.chave === chave)
                      if (!opts.length) return null
                      return (
                        <div key={chave}>
                          <div className="muted" style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 6 }}>{chave}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {opts.map((f) => {
                              const on = facetActive[chave] === f.valor
                              return (
                                <button
                                  key={`${chave}-${f.valor}`}
                                  type="button"
                                  className={`chip tag ${on ? 'filter-on' : ''}`}
                                  title={`${f.qtd} itens`}
                                  onClick={() => toggleFacet(chave, f.valor)}
                                >
                                  {f.valor}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            </div>
          </aside>

          <section className="gov-results">
            <div className="panel">
              <div className="panel-hd">
                <div className="title">
                  <strong>Resultados do catálogo</strong>
                  <small>Selecione itens oficiais para composição de custos no DFD</small>
                </div>
                <span className="chip">{resultCount} itens</span>
              </div>
            </div>

            {itemSel ? (
              <div className="panel">
                <div className="panel-hd">
                  <div className="title">
                    <strong>Item selecionado · {itemSel.codigo_item}</strong>
                    <small>Ajuste quantidade e preço antes de adicionar à lista</small>
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setItemSel(null)
                      setPreferred(null)
                      setPreco(null)
                    }}
                  >
                    ← Voltar
                  </button>
                </div>
                <div className="panel-bd stack">
                  <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.5 }}>{itemSel.descricao}</p>
                  <div className="item-card-tags">
                    {catmatAttributeTags(itemSel.descricao).map((t) => (
                      <span key={t} className="chip muted">{t}</span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                    {priceLoading && <span className="chip">Consultando preços…</span>}
                    {!priceLoading && priceStale && (
                      <span className="chip warn">Referência desatualizada — atualizando em background</span>
                    )}
                    {!priceLoading && (
                      <button type="button" className="btn ghost" onClick={refreshPrecos} disabled={priceLoading}>
                        Atualizar preço
                      </button>
                    )}
                  </div>

                  {priceLoading && (
                    <div className="stack-sm">
                      <div className="skel" />
                      <div className="skel" style={{ height: 20, width: '60%' }} />
                      <span className="chip">Consultando preços Compras.gov.br…</span>
                    </div>
                  )}

                  {!priceLoading && enrichment && (enrichment.unidadeFornecimento || enrichment.naturezaDespesa) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {enrichment.unidadeFornecimento?.nome && (
                        <span className="chip">Unidade CATMAT: {enrichment.unidadeFornecimento.nome}</span>
                      )}
                      {enrichment.naturezaDespesa?.codigo && (
                        <span className="chip">
                          ND: {enrichment.naturezaDespesa.codigo}
                          {enrichment.naturezaDespesa.nome ? ` · ${enrichment.naturezaDespesa.nome}` : ''}
                        </span>
                      )}
                    </div>
                  )}

                  {!priceLoading && preferred && (
                    <div className="price-card">
                      <div className="headline">
                        <span className="val mono">{formatBRL(preferred.mediana)}</span>
                        <span className="lbl">mediana ({preferred.n} registros · 12 meses)</span>
                      </div>
                      <div className="price-stats">
                        <Stat k="p25" v={formatBRL(preferred.p25)} />
                        <Stat k="p75" v={formatBRL(preferred.p75)} />
                        <Stat k="mín" v={formatBRL(preferred.minimo)} />
                        <Stat k="máx" v={formatBRL(preferred.maximo)} />
                      </div>
                      <div style={{ marginTop: '0.75rem' }}>
                        <span className="chip ok">{precoFonteBadge(preferred.fonte)}</span>
                      </div>
                    </div>
                  )}

                  {!priceLoading && !preferred && (
                    <div className="empty" style={{ padding: '1rem', textAlign: 'left', alignItems: 'flex-start' }}>
                      <div className="empty-title" style={{ marginBottom: 4 }}>Sem referência automática</div>
                      <div>Informe o R$ unitário manualmente abaixo.</div>
                    </div>
                  )}

                  {!priceLoading && recentPrecos.length > 0 && (
                    <div>
                      <div className="muted" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                        Compras recentes (12 meses)
                      </div>
                      <div className="table-wrap custom-scrollbar" style={{ maxHeight: 220 }}>
                        <table className="lista">
                          <thead>
                            <tr>
                              <th>Data</th>
                              <th>Fonte</th>
                              <th>Órgão / UASG</th>
                              <th>UF</th>
                              <th>Qtd</th>
                              <th>R$ un.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentPrecos.slice(0, 15).map((r, i) => (
                              <tr key={`${r.fonte}-${r.data_resultado}-${i}`}>
                                <td className="mono">{r.data_resultado || '—'}</td>
                                <td>{r.fonte === 'siasg' ? 'SIASG' : 'PNCP'}</td>
                                <td>{r.orgao_nome || '—'}</td>
                                <td>{r.uf || '—'}</td>
                                <td className="mono">{r.quantidade ?? '—'}</td>
                                <td className="mono">{formatBRL(Number(r.preco_unitario))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="field-row">
                    <label className="field">
                      <span>Quantidade</span>
                      <input className="mono" type="number" min={1} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} />
                    </label>
                    <label className="field">
                      <span>R$ unitário (editável)</span>
                      <input
                        className="mono"
                        type="number"
                        min={0}
                        step={0.01}
                        value={preco ?? ''}
                        onChange={(e) => {
                          setPreco(Number(e.target.value))
                          setPrecoFonte('manual')
                        }}
                      />
                    </label>
                  </div>
                  <button className="btn primary" onClick={addItem} style={{ width: '100%', justifyContent: 'center', padding: '0.7rem' }} type="button">
                    Adicionar à Minha Lista DFD
                  </button>
                </div>
              </div>
            ) : pdmSel ? (
              <>
                <div className="search-shell">
                  <input
                    className="search-box"
                    placeholder="Refinar: split teto 30000, inverter, 621109…"
                    value={itemFilter}
                    onChange={(e) => {
                      setItemFilter(e.target.value)
                      setFacetActive({})
                    }}
                  />
                </div>
                <div className="scroll-area custom-scrollbar stack-sm" style={{ maxHeight: '70vh' }}>
                  {filteredItemHits.map((it) => (
                    <button
                      key={it.codigo_item}
                      type="button"
                      className="item-card"
                      onClick={() => openItem(it)}
                    >
                      <div className="item-card-code">CATMAT {it.codigo_item}</div>
                      <div style={{ fontSize: '0.88rem', lineHeight: 1.45, marginTop: 4, fontWeight: 500 }}>{it.descricao}</div>
                      <div className="item-card-tags">
                        {catmatAttributeTags(it.descricao).map((t) => (
                          <span key={t} className="chip muted">{t}</span>
                        ))}
                      </div>
                    </button>
                  ))}
                  {!filteredItemHits.length && (
                    <div className="empty">Nenhuma opção com esse filtro.</div>
                  )}
                </div>
              </>
            ) : (
              <div className="stack-sm">
                {freeItems.map((it) => (
                  <button
                    key={it.codigo_item}
                    type="button"
                    className="item-card"
                    onClick={() => openItem(it)}
                  >
                    <div className="item-card-code">CATMAT {it.codigo_item}</div>
                    <div style={{ fontSize: '0.88rem', lineHeight: 1.45, marginTop: 4, fontWeight: 500 }}>{it.descricao}</div>
                    <div className="item-card-tags">
                      <span className="chip">{it.nome_pdm}</span>
                      {catmatAttributeTags(it.descricao, 4).map((t) => (
                        <span key={t} className="chip muted">{t}</span>
                      ))}
                    </div>
                  </button>
                ))}
                {!freeItems.length && pdms.length > 0 && (
                  <div className="empty">
                    <div className="empty-title">Escolha um PDM</div>
                    <div>Selecione um grupo à esquerda para ver todas as variações do item.</div>
                  </div>
                )}
                {!freeItems.length && !pdms.length && !searching && (
                  <div className="empty">Nenhum resultado para este termo.</div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v mono">{v}</div>
    </div>
  )
}
