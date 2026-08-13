import { NextResponse } from 'next/server'
import { COMPRAS_BASE } from '@/lib/compras-api'

export const dynamic = 'force-dynamic'

/** Verifica conectividade com Compras.gov.br no servidor (evita CORS no browser). */
export async function GET() {
  try {
    const url = `${COMPRAS_BASE}/modulo-material/1_consultarGrupoMaterial?pagina=1&tamanhoPagina=1`
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      next: { revalidate: 60 },
    })
    return NextResponse.json({ online: res.ok, status: res.status })
  } catch {
    return NextResponse.json({ online: false, status: 0 })
  }
}
