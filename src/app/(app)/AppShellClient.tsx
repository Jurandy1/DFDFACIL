'use client'

import dynamic from 'next/dynamic'
import { DemandaProvider } from '@/lib/DemandaProvider'

const AppShell = dynamic(() => import('./AppShell'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#64748b' }}>
      Carregando…
    </div>
  ),
})

export default function AppShellClient({ children }: { children: React.ReactNode }) {
  return (
    <DemandaProvider>
      <AppShell>{children}</AppShell>
    </DemandaProvider>
  )
}
