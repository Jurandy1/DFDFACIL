require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  const pdms = await c.query('select * from buscar_pdms($1, 5)', ['cadeira'])
  console.log('PDMs', pdms.rows)
  if (pdms.rows[0]) {
    const itens = await c.query('select codigo_item, left(descricao,80) as d, score from buscar_itens_no_pdm($1,$2,5)', [
      pdms.rows[0].codigo_pdm,
      'cadeira',
    ])
    console.log('ITENS', itens.rows)
    const u = await c.query('select sugerir_unidade($1) as u', [pdms.rows[0].codigo_pdm])
    console.log('UNIDADE', u.rows[0])
  }
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
