'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DemandaItem } from '@/lib/types'

export type Demanda = {
  id: string
  titulo: string
  objeto: string | null
  observacao: string | null
}

export function useDemanda() {
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

  return { supabase, demanda, setDemanda, itens, setItens, loading, status, setStatus, reload: load }
}
