require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  console.log('aplicando search-fast...')
  const t0 = Date.now()
  await c.query(fs.readFileSync('supabase/search-fast.sql', 'utf8'))
  console.log('ok em', Date.now() - t0, 'ms')

  for (const q of ['cadeira', 'cadeira escritorio', 'projetor', 'ar condicionado']) {
    const a = Date.now()
    const pdms = await c.query('select nome_pdm, qtd_itens, score from buscar_pdms($1, 15)', [q])
    const b = Date.now()
    const itens = await c.query(
      'select codigo_item from buscar_itens_livre($1, 20)',
      [q]
    )
    const c2 = Date.now()
    console.log({
      q,
      pdms: pdms.rows.length,
      pdmsMs: b - a,
      itens: itens.rows.length,
      itensMs: c2 - b,
      top: pdms.rows.slice(0, 4).map((r) => `${r.nome_pdm}(${r.qtd_itens})`),
    })
  }
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
