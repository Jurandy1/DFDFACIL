require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  const row = await c.query(
    `select nome_normalizado from itens_material where codigo_item=621109`
  )
  console.log(row.rows[0])
  const f = await c.query(
    'select codigo_item from buscar_itens_no_pdm($1,$2,300)',
    [13768, 'teto/piso']
  )
  console.log('n', f.rows.length, 'has', f.rows.some((r) => r.codigo_item === 621109))
  const f2 = await c.query(
    'select codigo_item from buscar_itens_no_pdm($1,$2,50)',
    [13768, 'teto piso']
  )
  console.log('teto piso n', f2.rows.length, 'has', f2.rows.some((r) => r.codigo_item === 621109))
  await c.end()
}

main().catch(console.error)
