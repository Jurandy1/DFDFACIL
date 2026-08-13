require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  const r = await c.query(
    'select codigo_item, unidade from buscar_itens_no_pdm(18071, null, 5, null, null, null, $1)',
    ['ROLO']
  )
  console.log('filtro ROLO', r.rows)
  const s = await c.query(`
    select count(*)::int as n
    from itens_material
    where status_item and atributos ? 'UNIDADE DE MEDIDA'
  `)
  console.log('itens com UNIDADE DE MEDIDA no JSONB:', s.rows[0].n)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
