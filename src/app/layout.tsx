import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DFD Fácil — CATMAT + preços',
  description: 'Busca rápida de itens CATMAT e preços de referência para rascunho de demanda',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
