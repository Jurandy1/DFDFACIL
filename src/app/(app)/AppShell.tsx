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

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isList = pathname === '/'
  const isSearch = pathname?.startsWith('/pesquisa')

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">DF</span>
          <span className="brand-text">
            <strong>DFD Fácil</strong>
            <span>CATMAT · preços · lista</span>
          </span>
        </Link>

        <nav className="nav" aria-label="Seções">
          <Link href="/" className={isList ? 'active' : ''}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Minha lista
            {count != null && count > 0 && <span className="nav-badge">{count}</span>}
          </Link>
          <Link href="/pesquisa" className={isSearch ? 'active' : ''}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            Pesquisa avançada
          </Link>
        </nav>

        <div className="topbar-right">
          {email && <span className="chip muted" title={email}>{email}</span>}
          <button className="btn ghost" onClick={logout} aria-label="Sair">
            Sair
          </button>
        </div>
      </header>

      {children}
    </div>
  )
}
