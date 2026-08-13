'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DemandaItem } from '@/lib/types'

export type Demanda = {
  id: string
  titulo: string
  objeto: string | null
  observacao: string | null
}

type DemandaContextValue = {
  supabase: ReturnType<typeof createClient>
  demanda: Demanda | null
  setDemanda: React.Dispatch<React.SetStateAction<Demanda | null>>
  itens: DemandaItem[]
  setItens: React.Dispatch<React.SetStateAction<DemandaItem[]>>
  loading: boolean
  status: string
  setStatus: React.Dispatch<React.SetStateAction<string>>
  reload: () => Promise<void>
}

const DemandaContext = createContext<DemandaContextValue | null>(null)

export function DemandaProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [demanda, setDemanda] = useState<Demanda | null>(null)
  const [itens, setItens] = useState<DemandaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('Pronto')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: d, error } = await supabase.rpc('garantir_demanda')
      if (error) {
        setStatus(error.message)
        setItens([])
        return
      }
      const dem = (Array.isArray(d) ? d[0] : d) as Demanda
      if (!dem?.id) {
        setStatus('Demanda não encontrada')
        setItens([])
        return
      }
      setDemanda(dem)
      const { data: rows, error: itemsError } = await supabase
        .from('demanda_itens')
        .select('*')
        .eq('demanda_id', dem.id)
        .order('ordem', { ascending: true })
      if (itemsError) {
        setStatus(itemsError.message)
        setItens([])
        return
      }
      setItens((rows || []) as DemandaItem[])
      setStatus('Pronto')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Erro ao carregar lista')
      setItens([])
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    void load()
  }, [load])

  const value = useMemo(
    () => ({
      supabase,
      demanda,
      setDemanda,
      itens,
      setItens,
      loading,
      status,
      setStatus,
      reload: load,
    }),
    [supabase, demanda, itens, loading, status, load]
  )

  return <DemandaContext.Provider value={value}>{children}</DemandaContext.Provider>
}

export function useDemanda() {
  const ctx = useContext(DemandaContext)
  if (!ctx) throw new Error('useDemanda must be used within DemandaProvider')
  return ctx
}
