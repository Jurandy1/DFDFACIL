'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useDemanda } from '@/lib/DemandaProvider'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const { itens } = useDemanda()
  const [email, setEmail] = useState<string | null>(null)
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)
  const [mounted, setMounted] = useState(false)
  const count = itens.length

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    fetch('/api/compras-status')
      .then((r) => r.json())
      .then((data: { online?: boolean }) => {
        if (!cancelled) setApiOnline(Boolean(data.online))
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
  const isSearch = pathname.startsWith('/pesquisa')

  return (
    <div className="app-shell">
      <div className="gov-bar">
        <div className="gov-bar-left">
          <span className="dev-credit">Desenvolvido por Jurandy Santana</span>
        </div>
      </div>

      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">DF</span>
            <span className="brand-text">
              <span className="brand-title-row">
                <strong>DFD Fácil</strong>
              </span>
              <span className="hide-sm">Documento de Formalização da Demanda com Integração CATMAT</span>
            </span>
          </Link>

          <nav className="tab-nav" aria-label="Seções">
            <Link href="/pesquisa" className={mounted && isSearch ? 'active' : ''}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <span className="hide-sm">Pesquisa Avançada</span>
              <span className="show-sm-only">Pesquisa</span>
            </Link>
            <Link href="/" className={mounted && isList ? 'active' : ''}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
              <span className="hide-sm">Minha Lista DFD</span>
              <span className="show-sm-only">Lista</span>
              {mounted && count > 0 && <span className="nav-badge">{count}</span>}
            </Link>
          </nav>

          <div className="header-right">
            {mounted && (
              <div className={`api-status ${apiOnline === false ? 'offline' : ''}`}>
                <span className="api-dot" />
                <span>{apiOnline === false ? 'Offline' : apiOnline ? 'Online' : 'Verificando…'}</span>
              </div>
            )}
            {mounted && email && (
              <div className="user-block hide-sm">
                <div className="email">{email}</div>
                <div className="sub">Lista pessoal · base CATMAT</div>
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
