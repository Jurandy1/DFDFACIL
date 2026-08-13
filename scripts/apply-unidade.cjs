/**
 * Aplica supabase/unidade-medida.sql (funções + backfill SQL + RPCs).
 * Uso: node scripts/apply-unidade.cjs
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
  console.log('Aplicando unidade-medida.sql (pode levar alguns minutos)…')
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'unidade-medida.sql'), 'utf8')
  const t0 = Date.now()
  await c.query(sql)
  console.log(`OK aplicado em ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const stats = await c.query(`
    select
      count(*) filter (where unidade_medida is not null)::int as com_unidade,
      count(*) filter (where atributos ? 'UNIDADE DE MEDIDA')::int as json_unidade,
      count(*)::int as total
    from itens_material where status_item
  `)
  console.log('stats:', stats.rows[0])

  const top = await c.query(`
    select unidade_medida, count(*)::int n
    from itens_material where status_item and unidade_medida is not null
    group by 1 order by n desc limit 12
  `)
  console.log('top unidades:', top.rows)

  const fac = await c.query(`select chave, valor, qtd from facetas_pdm(18071, 10)`)
  console.log('facetas FITA ADESIVA:', fac.rows)

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
