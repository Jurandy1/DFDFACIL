'use client'

import { FormEvent, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('teste@gmail.com')
  const [password, setPassword] = useState('123456789')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password })
        if (err) throw err
      }
      router.push('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="gov-bar">
        <div className="gov-bar-left">
          <span className="brasil">BRASIL</span>
          <span className="sep">|</span>
          <span className="hide-sm">Ministério da Gestão e da Inovação em Serviços Públicos</span>
          <span className="show-sm-only">MGI</span>
        </div>
        <a
          href="https://dadosabertos.compras.gov.br/swagger-ui/index.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          API Compras.gov.br
        </a>
      </div>

      <main className="login-main">
        <form onSubmit={onSubmit} className="panel" style={{ width: '100%', maxWidth: 440 }}>
          <div className="panel-bd stack">
            <div className="brand" style={{ marginBottom: '0.5rem' }}>
              <span className="brand-mark">DF</span>
              <span className="brand-text">
                <span className="brand-title-row">
                  <strong>DFD Fácil</strong>
                  <span className="badge-api">API Gov.br</span>
                </span>
                <span>CATMAT & Gestão de Demandas — identidade Gov.br</span>
              </span>
            </div>

            <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
              Entre para montar sua lista de demanda com busca CATMAT e preços de referência Compras.gov.br.
            </p>

            <label className="field">
              <span>E-mail</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Senha</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{error}</p>}

            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading} type="submit">
              {loading ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
            <button
              type="button"
              className="btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            >
              {mode === 'login' ? 'Criar conta' : 'Já tenho conta'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
