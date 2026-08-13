require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  await c.query(fs.readFileSync('supabase/search-itens-fast.sql', 'utf8'))
  console.log('applied')
  for (const q of ['cadeira', 'cadeira escritorio', 'projetor', 'ar condicionado']) {
    const a = Date.now()
    const pdms = await c.query('select count(*)::int as n from buscar_pdms($1, 18)', [q])
    const b = Date.now()
    const itens = await c.query('select count(*)::int as n from buscar_itens_livre($1, 12)', [q])
    const c2 = Date.now()
    console.log({
      q,
      pdmsMs: b - a,
      pdms: pdms.rows[0].n,
      itensMs: c2 - b,
      itens: itens.rows[0].n,
    })
  }
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
