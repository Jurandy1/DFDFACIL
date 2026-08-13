require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const { Client } = require('pg')

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  await client.query(fs.readFileSync('supabase/search-upgrade.sql', 'utf8'))
  console.log('SEARCH_UPGRADE_OK')
  const r = await client.query('select nome_pdm, qtd_itens, score from buscar_pdms($1, 12)', ['cadeira'])
  console.log(r.rows)
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
