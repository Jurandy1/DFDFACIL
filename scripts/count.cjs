require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  for (const t of ['grupos_material', 'classes_material', 'pdms', 'itens_material']) {
    const r = await c.query(`select count(*)::int as n from ${t}`)
    console.log(t, r.rows[0].n)
  }
  const s = await c.query('select entidade, ultima_pagina, meta from sync_state order by 1')
  console.log('sync_state', s.rows)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
