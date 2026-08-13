/**
 * Verifica se os SQLs de performance estão aplicados no Supabase.
 * Uso: node scripts/check-supabase-sql.cjs
 * Requer DATABASE_URL ou SUPABASE_DB_URL no .env.local
 */
require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

async function main() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('Defina DATABASE_URL ou SUPABASE_DB_URL em .env.local')
    process.exit(1)
  }

  const client = new Client({ connectionString: url })
  await client.connect()

  const col = await client.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'pdms' and column_name = 'qtd_itens_ativos'
  `)
  const hasFastColumn = col.rows.length > 0
  console.log(hasFastColumn ? 'OK  qtd_itens_ativos existe' : 'FALTA  qtd_itens_ativos — rode supabase/search-fast.sql')

  const fn = await client.query(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'buscar_pdms'
    limit 1
  `)
  const def = fn.rows[0]?.def || ''
  const hasFastPdm = def.includes('qtd_itens_ativos')
  console.log(hasFastPdm ? 'OK  buscar_pdms otimizado' : 'FALTA  buscar_pdms antigo — rode supabase/search-fast.sql')

  const fn2 = await client.query(`
    select count(*)::int as n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'facetas_pdm'
  `)
  const hasFacetas = fn2.rows[0]?.n > 0
  console.log(hasFacetas ? 'OK  facetas_pdm existe' : 'FALTA  facetas_pdm — rode supabase/search-codigo.sql')

  const t0 = Date.now()
  await client.query(`select * from buscar_pdms('ar condicionado', 5)`)
  const ms = Date.now() - t0
  console.log(ms < 800 ? `OK  buscar_pdms ~${ms}ms` : `LENTO  buscar_pdms ~${ms}ms — aplique search-fast.sql`)

  if (!hasFastColumn || !hasFastPdm) {
    console.log('\nPara aplicar:')
    console.log('  psql $DATABASE_URL -f supabase/search-fast.sql')
    console.log('  psql $DATABASE_URL -f supabase/search-codigo.sql')
  }

  await client.end()
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
