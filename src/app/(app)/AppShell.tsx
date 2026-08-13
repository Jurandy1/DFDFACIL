'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()
  const [email, setEmail] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      setEmail(data.user?.email ?? null)

      const { data: dem } = await supabase.rpc('garantir_demanda')
      if (cancelled) return
      const demanda = Array.isArray(dem) ? dem[0] : dem
      if (!demanda?.id) return
      const { count: c } = await supabase
        .from('demanda_itens')
        .select('*', { count: 'exact', head: true })
        .eq('demanda_id', demanda.id)
      if (!cancelled) setCount(c ?? 0)
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, pathname])

  useEffect(() => {
    let cancelled = false
    fetch('https://dadosabertos.compras.gov.br/modulo-material/1_consultarGrupoMaterial?pagina=1&tamanhoPagina=10', {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
      .then((r) => {
        if (!cancelled) setApiOnline(r.ok)
      })
      .catch(() => {
        if (!cancelled) setApiOnline(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isList = pathname === '/'
  const isSearch = pathname?.startsWith('/pesquisa')

  return (
    <div className="app-shell">
      <div className="gov-bar">
        <div className="gov-bar-left">
          <span className="brasil">BRASIL</span>
          <span className="sep">|</span>
          <span className="hide-sm">Ministério da Gestão e da Inovação em Serviços Públicos</span>
          <span className="show-sm-only">MGI</span>
        </div>
        <div className="gov-bar-left">
          <a
            href="https://dadosabertos.compras.gov.br/swagger-ui/index.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            API Compras.gov.br
          </a>
        </div>
      </div>

      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">DF</span>
            <span className="brand-text">
              <span className="brand-title-row">
                <strong>DFD Fácil</strong>
                <span className="badge-api">API Gov.br</span>
              </span>
              <span className="hide-sm">Documento de Formalização da Demanda com Integração CATMAT</span>
            </span>
          </Link>

          <nav className="tab-nav" aria-label="Seções">
            <Link href="/pesquisa" className={isSearch ? 'active' : ''}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <span className="hide-sm">Pesquisa Avançada</span>
              <span className="show-sm-only">Pesquisa</span>
            </Link>
            <Link href="/" className={isList ? 'active' : ''}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
              <span className="hide-sm">Minha Lista DFD</span>
              <span className="show-sm-only">Lista</span>
              {count != null && count > 0 && <span className="nav-badge">{count}</span>}
            </Link>
          </nav>

          <div className="header-right">
            <div className={`api-status ${apiOnline === false ? 'offline' : ''}`}>
              <span className="api-dot" />
              <span>{apiOnline === false ? 'API Offline' : apiOnline ? 'API Online' : 'Verificando…'}</span>
            </div>
            {email && (
              <div className="user-block hide-sm">
                <div className="email">{email}</div>
                <div className="sub">Base local + Compras.gov.br</div>
              </div>
            )}
            <button className="btn ghost" onClick={logout} aria-label="Sair" type="button">
              Sair
            </button>
          </div>
        </div>
      </header>

      {children}
    </div>
  )
}
