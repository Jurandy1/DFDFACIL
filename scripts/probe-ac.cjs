require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()

  const livre = await c.query(
    'select codigo_item, left(descricao,100) d, score from buscar_itens_livre($1,20)',
    ['ar condicionado']
  )
  console.log('livre top20:')
  for (const r of livre.rows) console.log(r.codigo_item, r.score, r.d)

  const hit = await c.query(
    'select codigo_item from buscar_itens_livre($1,200) where codigo_item=621109',
    ['ar condicionado']
  )
  console.log('621109 in top200 livre?', hit.rows.length > 0)

  const noFilter = await c.query(
    'select codigo_item from buscar_itens_no_pdm($1,null,60) where codigo_item=621109',
    [13768]
  )
  console.log('621109 in first 60 of pdm?', noFilter.rows.length > 0)

  const sample = await c.query(
    `select left(descricao_completa,120) d
     from itens_material
     where codigo_pdm=13768 and status_item
     order by codigo_item
     limit 5`
  )
  console.log('sample items', sample.rows)

  // parse facet keys
  const keys = await c.query(`
    select key, count(*)::int n
    from (
      select trim(upper((regexp_matches(descricao_completa, '([A-ZÁÉÍÓÚÃÕÇ ]{3,40}):', 'gi'))[1])) as key
      from itens_material
      where codigo_pdm = 13768 and status_item
      limit 2000
    ) x
    where key is not null
    group by key
    order by n desc
    limit 20
  `)
  console.log('facet keys', keys.rows)

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
