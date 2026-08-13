'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  buildCsv,
  formatBRL,
  precoFonteBadge,
  type DemandaItem,
  type ItemHit,
  type PdmHit,
} from '@/lib/types'

type Demanda = {
  id: string
  titulo: string
  objeto: string | null
  observacao: string | null
}

type PreferredPrice = {
  mediana: number
  p25: number
  p75: number
  minimo: number
  maximo: number
  n: number
  fonte: string
  fonteRaw: string
}

export default function Workspace() {
  const supabase = createClient()
  const [demanda, setDemanda] = useState<Demanda | null>(null)
  const [itens, setItens] = useState<DemandaItem[]>([])
  const [termo, setTermo] = useState('')
  const [pdms, setPdms] = useState<PdmHit[]>([])
  const [pdmSel, setPdmSel] = useState<PdmHit | null>(null)
  const [itemHits, setItemHits] = useState<ItemHit[]>([])
  const [itemSel, setItemSel] = useState<ItemHit | null>(null)
  const [unidadeSug, setUnidadeSug] = useState('unidade')
  const [qtd, setQtd] = useState(1)
  const [preco, setPreco] = useState<number | null>(null)
  const [precoFonte, setPrecoFonte] = useState<string | null>(null)
  const [preferred, setPreferred] = useState<PreferredPrice | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [status, setStatus] = useState('Pronto')
  const [searching, setSearching] = useState(false)
  const [email, setEmail] = useState<string | null>(null)

  const total = useMemo(
    () =>
      itens.reduce(
        (acc, it) => acc + Number(it.quantidade || 0) * Number(it.preco_unitario || 0),
        0
      ),
    [itens]
  )

  const loadDemanda = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('garantir_demanda')
    if (error) {
      setStatus(error.message)
      return
    }
    const dem = (Array.isArray(d) ? d[0] : d) as Demanda
    setDemanda(dem)
    const { data: rows } = await supabase
      .from('demanda_itens')
      .select('*')
      .eq('demanda_id', dem.id)
      .order('ordem', { ascending: true })
    setItens((rows || []) as DemandaItem[])
  }, [supabase])

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      setEmail(data.user?.email ?? null)
      await loadDemanda()
    })()
  }, [loadDemanda, supabase.auth])

  useEffect(() => {
    if (termo.trim().length < 2) {
      setPdms([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      const { data, error } = await supabase.rpc('buscar_pdms', {
        termo: termo.trim(),
        lim: 25,
      })
      if (error) setStatus(error.message)
      else setPdms((data || []) as PdmHit[])
      setSearching(false)
    }, 280)
    return () => clearTimeout(t)
  }, [termo, supabase])

  async function openPdm(p: PdmHit) {
    setPdmSel(p)
    setItemSel(null)
    setPreferred(null)
    setPreco(null)
    setPrecoFonte(null)
    const [{ data: items }, { data: unid }] = await Promise.all([
      supabase.rpc('buscar_itens_no_pdm', {
        pdm: p.codigo_pdm,
        termo: termo.trim() || null,
        lim: 80,
      }),
      supabase.rpc('sugerir_unidade', { p_codigo_pdm: p.codigo_pdm }),
    ])
    setItemHits((items || []) as ItemHit[])
    setUnidadeSug((unid as string) || 'unidade')
  }

  async function openItem(it: ItemHit) {
    setItemSel(it)
    setQtd(1)
    setPriceLoading(true)
    setStatus('Buscando preços SIASG + PNCP…')
    try {
      const res = await fetch(`/api/precos?codigoItem=${it.codigo_item}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Falha nos preços')
      const pref = json.preferred as PreferredPrice | null
      setPreferred(pref)
      if (pref) {
        setPreco(Number(pref.mediana))
        setPrecoFonte(pref.fonte)
      } else {
        setPreco(null)
        setPrecoFonte(null)
      }
      setStatus('Preços atualizados')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Erro ao buscar preços')
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

    const payload = {
      demanda_id: demanda.id,
      codigo_item: itemSel.codigo_item,
      descricao: itemSel.descricao,
      unidade: itemSel.unidade || unidadeSug || 'unidade',
      quantidade: qtd,
      preco_unitario: preco,
      preco_fonte: fonte || precoFonte,
      ordem: itens.length + 1,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('demanda_itens').upsert(payload, {
      onConflict: 'demanda_id,codigo_item',
    })
    if (error) {
      setStatus(error.message)
      return
    }
    await supabase
      .from('demandas')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', demanda.id)
    setStatus('Salvo automaticamente')
    await loadDemanda()
  }

  async function updateItem(id: string, patch: Partial<DemandaItem>) {
    const { error } = await supabase
      .from('demanda_itens')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) setStatus(error.message)
    else {
      setStatus('Salvo automaticamente')
      await loadDemanda()
    }
  }

  async function removeItem(id: string) {
    await supabase.from('demanda_itens').delete().eq('id', id)
    setStatus('Item removido')
    await loadDemanda()
  }

  async function saveHeader(patch: Partial<Demanda>) {
    if (!demanda) return
    const next = { ...demanda, ...patch }
    setDemanda(next)
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
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lista-demanda-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">DFD Fácil</p>
            <h1 className="text-3xl font-semibold tracking-tight">Minha lista</h1>
            <p className="text-sm text-[var(--muted)]">{email}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--accent)]">
              {status}
            </span>
            <button
              onClick={logout}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm"
            >
              Sair
            </button>
          </div>
        </header>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <label className="block">
            <span className="text-sm text-[var(--muted)]">Título</span>
            <input
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              value={demanda?.titulo || ''}
              onChange={(e) => setDemanda((d) => (d ? { ...d, titulo: e.target.value } : d))}
              onBlur={(e) => saveHeader({ titulo: e.target.value })}
            />
          </label>
          <label className="mt-3 block">
            <span className="text-sm text-[var(--muted)]">Objeto (opcional)</span>
            <input
              className="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2"
              value={demanda?.objeto || ''}
              onChange={(e) => setDemanda((d) => (d ? { ...d, objeto: e.target.value } : d))}
              onBlur={(e) => saveHeader({ objeto: e.target.value })}
            />
          </label>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
            <h2 className="font-medium">Itens da demanda</h2>
            <div className="flex gap-2">
              <button
                onClick={copyTable}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm"
              >
                Copiar
              </button>
              <button
                onClick={downloadCsv}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
              >
                CSV
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-100/80 text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Unid.</th>
                  <th className="px-3 py-2">Qtd</th>
                  <th className="px-3 py-2">R$ Unid.</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Fonte</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it, idx) => (
                  <tr key={it.id} className="border-t border-[var(--line)] align-top">
                    <td className="px-3 py-2">{idx + 1}</td>
                    <td className="max-w-md px-3 py-2 text-[13px] leading-snug">{it.descricao}</td>
                    <td className="px-3 py-2">{it.unidade}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-20 rounded border border-[var(--line)] px-2 py-1"
                        value={it.quantidade}
                        onChange={(e) =>
                          setItens((rows) =>
                            rows.map((r) =>
                              r.id === it.id
                                ? { ...r, quantidade: Number(e.target.value) }
                                : r
                            )
                          )
                        }
                        onBlur={(e) =>
                          updateItem(it.id, { quantidade: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="w-28 rounded border border-[var(--line)] px-2 py-1"
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
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatBRL(Number(it.quantidade) * Number(it.preco_unitario || 0))}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px]">
                        {precoFonteBadge(it.preco_fonte)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="text-xs text-red-700 underline"
                        onClick={() => removeItem(it.id)}
                      >
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
                {!itens.length && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-[var(--muted)]">
                      Nenhum item ainda. Busque à direita e adicione.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between border-t border-[var(--line)] px-4 py-3 text-sm">
            <span className="text-[var(--muted)]">{itens.length} item(ns)</span>
            <strong>Total estimado: {formatBRL(total)}</strong>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <h2 className="font-medium">Buscar CATMAT</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Digite um termo (ex.: cadeira). Escolha o PDM e depois o item.
          </p>
          <input
            className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
            placeholder="O que você precisa?"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value)
              setPdmSel(null)
              setItemHits([])
              setItemSel(null)
            }}
          />
          {searching && <p className="mt-2 text-xs text-[var(--muted)]">Buscando PDMs…</p>}

          <div className="mt-3 max-h-56 space-y-1 overflow-auto">
            {pdms.map((p) => (
              <button
                key={p.codigo_pdm}
                onClick={() => openPdm(p)}
                className={`flex w-full items-start justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                  pdmSel?.codigo_pdm === p.codigo_pdm
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-transparent hover:bg-stone-100'
                }`}
              >
                <span>
                  <strong>{p.nome_pdm}</strong>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">
                    PDM {p.codigo_pdm} · score {Number(p.score).toFixed(2)}
                  </span>
                </span>
                <span className="text-xs text-[var(--muted)]">{p.qtd_itens} itens</span>
              </button>
            ))}
          </div>
        </div>

        {pdmSel && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <h3 className="font-medium">Itens — {pdmSel.nome_pdm}</h3>
            <p className="text-xs text-[var(--muted)]">Unidade sugerida: {unidadeSug}</p>
            <div className="mt-3 max-h-64 space-y-1 overflow-auto">
              {itemHits.map((it) => (
                <button
                  key={it.codigo_item}
                  onClick={() => openItem(it)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-[13px] leading-snug ${
                    itemSel?.codigo_item === it.codigo_item
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-transparent hover:bg-stone-100'
                  }`}
                >
                  {it.descricao}
                </button>
              ))}
              {!itemHits.length && (
                <p className="text-sm text-[var(--muted)]">
                  Sem itens neste PDM no banco. Rode o sync de itens.
                </p>
              )}
            </div>
          </div>
        )}

        {itemSel && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <h3 className="font-medium">Detalhe do item</h3>
            <p className="mt-2 text-sm leading-relaxed">{itemSel.descricao}</p>

            {priceLoading && (
              <p className="mt-3 text-sm text-[var(--muted)]">Consultando preços…</p>
            )}

            {preferred && (
              <div className="mt-3 rounded-xl bg-stone-100 p-3 text-sm">
                <p>
                  Mediana 12m: <strong>{formatBRL(preferred.mediana)}</strong> ({preferred.n}{' '}
                  registros)
                </p>
                <p className="text-[var(--muted)]">
                  p25 {formatBRL(preferred.p25)} · p75 {formatBRL(preferred.p75)} · min{' '}
                  {formatBRL(preferred.minimo)} · max {formatBRL(preferred.maximo)}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wide text-[var(--accent)]">
                  {precoFonteBadge(preferred.fonte)}
                </p>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                Quantidade
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2"
                  value={qtd}
                  onChange={(e) => setQtd(Number(e.target.value))}
                />
              </label>
              <label className="block text-sm">
                R$ unitário
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2"
                  value={preco ?? ''}
                  onChange={(e) => {
                    setPreco(Number(e.target.value))
                    setPrecoFonte('manual')
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Badge atual: {precoFonteBadge(precoFonte)}
            </p>
            <button
              onClick={addItem}
              className="mt-4 w-full rounded-xl bg-[var(--accent)] px-4 py-2.5 font-medium text-white"
            >
              Adicionar à lista
            </button>
          </div>
        )}
      </aside>
    </main>
  )
}
