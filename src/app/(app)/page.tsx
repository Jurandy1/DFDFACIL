'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useDemanda } from '@/lib/DemandaProvider'
import { buildCsv, formatBRL, precoFonteBadge, type DemandaItem } from '@/lib/types'

export default function ListaPage() {
  const {
    supabase,
    demanda,
    setDemanda,
    itens,
    setItens,
    loading,
    status,
    setStatus,
    reload,
  } = useDemanda()

  const total = useMemo(
    () =>
      itens.reduce(
        (acc, it) => acc + Number(it.quantidade || 0) * Number(it.preco_unitario || 0),
        0
      ),
    [itens]
  )

  const comPreco = useMemo(
    () => itens.filter((it) => it.preco_unitario != null).length,
    [itens]
  )

  async function updateItem(id: string, patch: Partial<DemandaItem>) {
    const { error } = await supabase
      .from('demanda_itens')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) setStatus(error.message)
    else {
      setStatus('Salvo automaticamente')
      await reload()
    }
  }

  async function removeItem(id: string) {
    await supabase.from('demanda_itens').delete().eq('id', id)
    setStatus('Item removido')
    await reload()
  }

  async function saveHeader(patch: Partial<NonNullable<typeof demanda>>) {
    if (!demanda) return
    setDemanda({ ...demanda, ...patch })
    await supabase
      .from('demandas')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', demanda.id)
    setStatus('Salvo automaticamente')
  }

  function copyTable() {
    const text = itens
      .map((it, i) => {
        const tot = Number(it.quantidade) * Number(it.preco_unitario || 0)
        return `${i + 1}\t${it.descricao}\t${it.unidade}\t${it.quantidade}\t${formatBRL(it.preco_unitario)}\t${formatBRL(tot)}`
      })
      .join('\n')
    navigator.clipboard.writeText(text)
    setStatus('Tabela copiada')
  }

  function downloadCsv() {
    const csv = buildCsv(itens)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `DFD_Demanda_CATMAT_Gov_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="gov-main">
      <div className="demand-banner">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: 4 }}>
            <h2>{demanda?.titulo?.trim() || 'Minha Lista DFD'}</h2>
            <span className="status-draft">
              <span className="dot" />
              Em elaboração (rascunho)
            </span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
            Documento de Formalização da Demanda — exportação CSV para sua lista
          </p>
        </div>
        <Link href="/pesquisa" className="btn primary">
          Buscar itens no CATMAT
        </Link>
      </div>

      <div className="status-row">
        <span className="chip accent"><span className="dot" />{status}</span>
      </div>

      <div className="summary-strip">
        <SummaryCard
          label="Total de itens na lista"
          value={itens.length.toString()}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <rect x="3" y="10" width="18" height="4" rx="1" />
              <rect x="3" y="16" width="18" height="4" rx="1" />
            </svg>
          }
        />
        <SummaryCard
          label="Itens com preço definido"
          value={`${comPreco} / ${itens.length || 0}`}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        />
        <SummaryCard
          label="Valor estimado total"
          value={formatBRL(total)}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
        />
      </div>

      <div className="stack">
        <div className="panel">
          <div className="panel-hd">
            <div className="title">
              <strong>Identificação do rascunho do DFD</strong>
              <small>Campos usados na exportação CSV da lista</small>
            </div>
          </div>
          <div className="panel-bd">
            <div className="field-row">
              <label className="field">
                <span>Título</span>
                <input
                  placeholder="Ex.: Aquisição de mobiliário 2026"
                  value={demanda?.titulo || ''}
                  onChange={(e) => setDemanda((d) => (d ? { ...d, titulo: e.target.value } : d))}
                  onBlur={(e) => saveHeader({ titulo: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Objeto (opcional)</span>
                <input
                  placeholder="Ex.: cadeiras giratórias para o setor administrativo"
                  value={demanda?.objeto || ''}
                  onChange={(e) => setDemanda((d) => (d ? { ...d, objeto: e.target.value } : d))}
                  onBlur={(e) => saveHeader({ objeto: e.target.value })}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="title">
              <strong>Itens da minha lista</strong>
              <small>{itens.length} {itens.length === 1 ? 'item' : 'itens'} · CSV: UASG; CodigoCATMAT; DescricaoItem…</small>
            </div>
            <div className="row">
              <button className="btn" onClick={copyTable} disabled={!itens.length}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copiar
              </button>
              <button className="btn primary" onClick={downloadCsv} disabled={!itens.length}>
                Exportar CSV Gov
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="lista">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>Item & especificação CATMAT</th>
                  <th style={{ width: 90 }}>Unidade</th>
                  <th style={{ width: 100 }}>Qtd</th>
                  <th style={{ width: 130 }}>R$ un. ref.</th>
                  <th style={{ width: 130 }}>Valor total</th>
                  <th style={{ width: 50 }} aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {loading && !itens.length && (
                  <tr>
                    <td colSpan={7}>
                      <div className="stack-sm" style={{ padding: '0.75rem' }}>
                        <div className="skel" />
                        <div className="skel" />
                        <div className="skel" />
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && !itens.length && (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <div className="empty-ico">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M20 7h-3V4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v3H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
                          </svg>
                        </div>
                        <div className="empty-title">Nenhum item ainda</div>
                        <div>Vá para <Link href="/pesquisa" style={{ color: 'var(--accent)', fontWeight: 600 }}>Pesquisa avançada</Link> e adicione itens à sua lista.</div>
                      </div>
                    </td>
                  </tr>
                )}
                {itens.map((it, idx) => (
                  <tr key={it.id}>
                    <td><span className="row-num">{idx + 1}</span></td>
                    <td>
                      <div style={{ lineHeight: 1.4, fontWeight: 500 }}>{it.descricao}</div>
                      <div style={{ marginTop: 6, display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <span className="chip mono">CATMAT {it.codigo_item}</span>
                        <span className={`chip ${it.preco_fonte === 'manual' ? 'warn' : it.preco_fonte ? 'ok' : ''}`}>
                          {precoFonteBadge(it.preco_fonte)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="chip">{it.unidade || 'unidade'}</span>
                    </td>
                    <td>
                      <input
                        className="cell-input mono"
                        style={{ maxWidth: 80 }}
                        type="number"
                        min={1}
                        value={it.quantidade}
                        onChange={(e) =>
                          setItens((rows) =>
                            rows.map((r) =>
                              r.id === it.id ? { ...r, quantidade: Number(e.target.value) } : r
                            )
                          )
                        }
                        onBlur={(e) => updateItem(it.id, { quantidade: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-input mono"
                        style={{ maxWidth: 110 }}
                        type="number"
                        step={0.01}
                        value={it.preco_unitario ?? ''}
                        onChange={(e) =>
                          setItens((rows) =>
                            rows.map((r) =>
                              r.id === it.id
                                ? { ...r, preco_unitario: Number(e.target.value) }
                                : r
                            )
                          )
                        }
                        onBlur={(e) =>
                          updateItem(it.id, {
                            preco_unitario: Number(e.target.value),
                            preco_fonte: 'manual',
                          })
                        }
                      />
                    </td>
                    <td className="mono" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {formatBRL(Number(it.quantidade) * Number(it.preco_unitario || 0))}
                    </td>
                    <td>
                      <button
                        className="btn icon danger"
                        onClick={() => removeItem(it.id)}
                        aria-label="Remover item"
                        title="Remover"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {itens.length > 0 && (
            <div className="panel-ft">
              <span className="chip">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span>
              <div className="row">
                <span className="muted" style={{ fontSize: '0.85rem' }}>Valor total estimado</span>
                <strong className="mono" style={{ fontSize: '1.15rem' }}>{formatBRL(total)}</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="summary-card">
      <div className="ico">{icon}</div>
      <div className="txt">
        <span className="lbl">{label}</span>
        <span className="val mono">{value}</span>
      </div>
    </div>
  )
}
