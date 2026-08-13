# DFD Fácil

Rascunho simples de demanda com busca CATMAT local (obrigatória — a API do governo não filtra por texto) + preços de referência SIASG/PNCP.

## Stack
- Next.js + Supabase Auth/Postgres
- Sync: `scripts/sync-material.cjs`
- Schema: `supabase/schema.sql`

## Setup
1. Copie `.env.example` → `.env.local` e preencha as chaves do Supabase.
2. Aplique o schema: `npm run db:schema`
3. Sync catálogo:
   - `npm run sync` (grupos, classes, PDMs, itens)
   - ou `npm run sync:itens` só para itens (demora — ~344k ativos)
4. `npm run dev`

## Uso
1. Crie conta / login
2. Busque por termo → escolha PDM → item
3. Veja mediana de preços (editável) e adicione à lista (auto-save)
4. Copie a tabela ou baixe CSV

## Observações
- Planilha com matching em massa ficou para v1.1
- Não gera DOCX formal de DFD — só lista para visualizar/copiar
