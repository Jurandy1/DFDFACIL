import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DFD Fácil — CATMAT + preços',
  description: 'Busca rápida de itens CATMAT e preços de referência para rascunho de demanda',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
