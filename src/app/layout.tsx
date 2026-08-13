import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DFD Fácil — CATMAT & Gestão de Demandas (Gov.br)',
  description: 'Busca CATMAT integrada à API Compras.gov.br, preços de referência e gestão de demanda para DFD',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
