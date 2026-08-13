'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useDemanda } from '@/lib/useDemanda'
import {
  formatBRL,
  precoFonteBadge,
  type ItemHit,
  type PdmHit,
} from '@/lib/types'

type PreferredPrice = {
  mediana: number
  p25: number
  p75: number
  minimo: number
  maximo: number
  n: number
  fonte: string
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
  const [priceLoading, setPriceLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [autoOpenedFor, setAutoOpenedFor] = useState('')

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

    const tPdm = setTimeout(async () => {
      setSearching(true)
      if (codePrefix) {
        const byCode = await supabase.rpc('buscar_itens_livre', { termo: q, lim: 5 })
        if (!byCode.error) {
          setFreeItems((byCode.data || []) as FreeItem[])
          setPdms([])
        }
        setSearching(false)
        return
      }

      const pdmRes = await supabase.rpc('buscar_pdms', { termo: q, lim: 18 })
      if (pdmRes.error) setStatus(pdmRes.error.message)
      else setPdms((pdmRes.data || []) as PdmHit[])
      setSearching(false)
    }, 150)

    const tItens = setTimeout(async () => {
      if (codePrefix) return
      const itemRes = await supabase.rpc('buscar_itens_livre', { termo: q, lim: 16 })
      if (!itemRes.error) setFreeItems((itemRes.data || []) as FreeItem[])
    }, 350)

    return () => {
      clearTimeout(tPdm)
      clearTimeout(tItens)
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
    const [{ data: items }, { data: unid }, { data: fac }] = await Promise.all([
      supabase.rpc('buscar_itens_no_pdm', {
        pdm: p.codigo_pdm,
        termo: hint || null,
        lim: hint ? 100 : 80,
      }),
      supabase.rpc('sugerir_unidade', { p_codigo_pdm: p.codigo_pdm }),
      supabase.rpc('facetas_pdm', { pdm: p.codigo_pdm, lim_por_chave: 14 }),
    ])
    setItemHits((items || []) as ItemHit[])
    setUnidadeSug((unid as string) || 'unidade')
    setFacetas((fac || []) as Faceta[])
    setStatus(
      `${(items || []).length} opções em ${p.nome_pdm} — use Tipo / Modelo / Capacidade abaixo`
    )
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

  async function openItem(it: ItemHit) {
    setItemSel(it)
    setQtd(1)
    setPreferred(null)
    setPreco(null)
    setPrecoFonte(null)
    setPriceLoading(true)
    setStatus('Buscando preços…')
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 25000)
      const res = await fetch(`/api/precos?codigoItem=${it.codigo_item}`, {
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Falha nos preços')
      const pref = json.preferred as PreferredPrice | null
      setPreferred(pref)
      if (pref) {
        setPreco(Number(pref.mediana))
        setPrecoFonte(pref.fonte)
        setStatus(`Preço ok · mediana ${formatBRL(pref.mediana)}`)
      } else {
        setPreco(null)
        setPrecoFonte(null)
        const hint = json.meta?.fetchError
          ? String(json.meta.fetchError)
          : 'Sem preços encontrados — preencha manualmente'
        setStatus(hint)
      }
      if (json.unidadeSugerida) setUnidadeSug(String(json.unidadeSugerida))
    } catch (e) {
      const msg =
        e instanceof Error && e.name === 'AbortError'
          ? 'Consulta de preço demorou demais — preencha manualmente'
          : e instanceof Error
            ? e.message
            : 'Erro ao buscar preços'
      setStatus(msg)
    } finally {
      setPriceLoading(false)
    }
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

  return (
    <main className="container container-wide">
      <div className="page-hd">
        <div>
          <h1>Pesquisa avançada</h1>
          <p>Busque na base CATMAT, escolha o item e consulte preço de referência.</p>
        </div>
        <div className="actions">
          <span className="chip accent"><span className="dot" />{status}</span>
          <Link href="/" className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Ver lista ({itens.length})
          </Link>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-bd">
          <div className="search-shell">
            <input
              className="search-box"
              placeholder='Ex.: ar condicionado · ou mais específico: ar condicionado split teto 30000'
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
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {searching && <span className="chip"><span className="dot" style={{ background: 'var(--accent)' }} /> buscando…</span>}
            {!searching && showResults && (
              <>
                <span className="chip">{pdms.length} tipos (PDMs)</span>
                <span className="chip">{freeItems.length} itens diretos</span>
              </>
            )}
            {!showResults && (
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                Dica: digite pelo menos 2 letras para começar.
              </span>
            )}
          </div>
        </div>
      </div>

      {!showResults ? (
        <div className="panel">
          <div className="panel-bd">
            <div className="empty">
              <div className="empty-ico">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <div className="empty-title">Comece a pesquisar</div>
              <div>Encontre PDMs (tipos de material) ou pule direto ao item específico.</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="search-grid">
          <div className="stack">
            <div className="panel">
              <div className="panel-hd">
                <div className="title">
                  <strong>Tipos / PDMs</strong>
                  <small>Escolha uma categoria para ver todos os itens</small>
                </div>
                <span className="chip">{pdms.length}</span>
              </div>
              <div className="panel-bd">
                <div className="scroll-area option-list" style={{ maxHeight: 260 }}>
                  {pdms.map((p) => (
                    <button
                      key={p.codigo_pdm}
                      className={`option ${pdmSel?.codigo_pdm === p.codigo_pdm ? 'active' : ''}`}
                      onClick={() => openPdm(p)}
                    >
                      <div className="title-line">
                        <span className="title">{p.nome_pdm}</span>
                        <span className="chip">{p.qtd_itens} itens</span>
                      </div>
                      <span className="meta">PDM {p.codigo_pdm}</span>
                    </button>
                  ))}
                  {!pdms.length && !searching && (
                    <div className="empty">
                      <div>Nenhum tipo encontrado para esse termo.</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-hd">
                <div className="title">
                  <strong>Itens sugeridos</strong>
                  <small>Amostra do tipo mais relevante (refine com filtros à direita)</small>
                </div>
                <span className="chip">{freeItems.length}</span>
              </div>
              <div className="panel-bd">
                <div className="scroll-area option-list" style={{ maxHeight: 240 }}>
                  {freeItems.map((it) => (
                    <button
                      key={it.codigo_item}
                      className={`option ${itemSel?.codigo_item === it.codigo_item ? 'active' : ''}`}
                      onClick={() => openItem(it)}
                    >
                      <span className="title" style={{ fontWeight: 500 }}>{it.descricao}</span>
                      <span className="meta">{it.nome_pdm} · item {it.codigo_item}</span>
                    </button>
                  ))}
                  {!freeItems.length && !searching && (
                    <div className="empty">
                      <div>Nenhum atalho — abra um tipo e use Tipo / Modelo / Capacidade.</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="stack" style={{ position: 'sticky', top: 84 }}>
            {pdmSel && !itemSel && (
              <div className="panel">
                <div className="panel-hd">
                  <div className="title">
                    <strong>{pdmSel.nome_pdm}</strong>
                    <small>{filteredItemHits.length} opções · unidade sugerida: {unidadeSug}</small>
                  </div>
                </div>
                <div className="panel-bd">
                  {!!facetas.length && (
                    <div className="facet-block" style={{ marginBottom: '0.85rem' }}>
                      {(['TIPO', 'MODELO', 'CAPACIDADE', 'TENSÃO', 'CARACTERÍSTICAS'] as const).map((chave) => {
                        const opts = facetas.filter((f) => f.chave === chave)
                        if (!opts.length) return null
                        return (
                          <div key={chave} style={{ marginBottom: '0.55rem' }}>
                            <div className="muted" style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 6 }}>
                              {chave}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {opts.map((f) => {
                                const on = facetActive[chave] === f.valor
                                return (
                                  <button
                                    key={`${chave}-${f.valor}`}
                                    type="button"
                                    className={`chip ${on ? 'accent' : ''}`}
                                    style={{ cursor: 'pointer', border: 'none', maxWidth: 220 }}
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
                      {!!Object.keys(facetActive).length && (
                        <button
                          type="button"
                          className="btn ghost"
                          style={{ marginTop: 4, fontSize: '0.8rem' }}
                          onClick={() => {
                            setFacetActive({})
                            setItemFilter('')
                          }}
                        >
                          Limpar filtros
                        </button>
                      )}
                    </div>
                  )}
                  <div className="search-shell">
                    <input
                      className="search-box"
                      style={{ padding: '0.75rem 1rem 0.75rem 2.75rem', fontSize: '0.9rem' }}
                      placeholder="Ou digite: split teto 30000, inverter, 621109…"
                      value={itemFilter}
                      onChange={(e) => {
                        setItemFilter(e.target.value)
                        setFacetActive({})
                      }}
                    />
                  </div>
                  <div className="scroll-area option-list" style={{ maxHeight: 360, marginTop: '0.75rem' }}>
                    {filteredItemHits.map((it) => (
                      <button
                        key={it.codigo_item}
                        className="option"
                        onClick={() => openItem(it)}
                      >
                        <span className="title" style={{ fontWeight: 500 }}>{it.descricao}</span>
                      </button>
                    ))}
                    {!filteredItemHits.length && (
                      <div className="empty">Nenhuma opção com esse filtro.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {itemSel && (
              <div className="panel">
                <div className="panel-hd">
                  <div className="title">
                    <strong>Item selecionado</strong>
                    <small>Ajuste quantidade e preço antes de adicionar</small>
                  </div>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setItemSel(null)
                      setPreferred(null)
                      setPreco(null)
                    }}
                    aria-label="Fechar"
                    title="Voltar"
                  >
                    ← Voltar
                  </button>
                </div>
                <div className="panel-bd stack">
                  <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.5 }}>{itemSel.descricao}</p>

                  {priceLoading && (
                    <div className="stack-sm">
                      <div className="skel" />
                      <div className="skel" style={{ height: 20, width: '60%' }} />
                    </div>
                  )}

                  {!priceLoading && preferred && (
                    <div className="price-card">
                      <div className="headline">
                        <span className="val mono">{formatBRL(preferred.mediana)}</span>
                        <span className="lbl">mediana ({preferred.n} registros)</span>
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
                      <div>
                        <div className="empty-title" style={{ marginBottom: 4 }}>Sem referência automática</div>
                        <div>Informe o R$ unitário manualmente abaixo.</div>
                      </div>
                    </div>
                  )}

                  <div className="field-row">
                    <label className="field">
                      <span>Quantidade</span>
                      <input
                        className="mono"
                        type="number"
                        min={1}
                        value={qtd}
                        onChange={(e) => setQtd(Number(e.target.value))}
                      />
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
                  <button className="btn primary" onClick={addItem} style={{ width: '100%', justifyContent: 'center', padding: '0.7rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Adicionar à lista
                  </button>
                </div>
              </div>
            )}

            {!pdmSel && !itemSel && (
              <div className="panel">
                <div className="panel-bd">
                  <div className="empty">
                    <div className="empty-ico">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="9 11 12 14 22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    </div>
                    <div className="empty-title">Escolha um resultado</div>
                    <div>Selecione um tipo (PDM) ou um item direto ao lado.</div>
                  </div>
                </div>
              </div>
            )}
          </div>
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
