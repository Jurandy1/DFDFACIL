/**
 * Aplica migration atributos-estruturados.sql no Supabase.
 * Uso: node scripts/apply-atributos.cjs
 */
require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

async function main() {
  const url = process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL
  if (!url) {
    console.error('Defina DATABASE_URL em .env.local')
    process.exit(1)
  }
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'atributos-estruturados.sql'), 'utf8')
  await c.query(sql)
  console.log('OK  atributos-estruturados.sql aplicado')

  const cols = await c.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='itens_material'
      and column_name in ('atributos','tem_forno','capacidade_btu','qtd_bocas')
    order by column_name
  `)
  console.log('colunas:', cols.rows.map((r) => r.column_name).join(', '))
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
