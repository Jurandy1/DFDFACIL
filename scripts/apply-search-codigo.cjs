require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  await c.query(fs.readFileSync('supabase/search-codigo.sql', 'utf8'))
  console.log('applied')

  const pdms = await c.query(
    'select nome_pdm, qtd_itens, score from buscar_pdms($1, 8)',
    ['ar condicionado']
  )
  console.log(
    'pdms',
    pdms.rows.map((r) => `${r.nome_pdm}(${r.qtd_itens})#${r.score}`)
  )

  const livre = await c.query(
    'select codigo_item, left(descricao,95) d, score from buscar_itens_livre($1, 15)',
    ['ar condicionado']
  )
  console.log('livre:')
  for (const r of livre.rows) console.log(r.score, r.codigo_item, r.d)

  const specific = await c.query(
    'select codigo_item, score, left(descricao,80) d from buscar_itens_livre($1, 10)',
    ['ar condicionado split teto 30000']
  )
  console.log('specific', specific.rows)

  const pdms2 = await c.query(
    'select nome_pdm, score from buscar_pdms($1, 5)',
    ['ar condicionado split teto 30000']
  )
  console.log('pdms specific', pdms2.rows)

  const facets = await c.query(
    'select chave, valor, qtd from facetas_pdm($1, 10)',
    [13768]
  )
  console.log(
    'facets',
    facets.rows.slice(0, 25).map((r) => `${r.chave}=${r.valor}(${r.qtd})`)
  )

  const filtered = await c.query(
    'select codigo_item from buscar_itens_no_pdm($1,$2,30)',
    [13768, 'split teto 30000']
  )
  console.log(
    'filter split teto 30000 has 621109?',
    filtered.rows.some((r) => r.codigo_item === 621109),
    'n=',
    filtered.rows.length
  )

  const open = await c.query(
    'select codigo_item from buscar_itens_no_pdm($1,null,40) where codigo_item=621109',
    [13768]
  )
  console.log('621109 in first 40 configured?', open.rows.length > 0)

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
