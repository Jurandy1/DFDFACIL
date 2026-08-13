require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const { Client } = require('pg')

async function main() {
  const connectionString =
    process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  const sql = fs.readFileSync('supabase/schema.sql', 'utf8')
  await client.query(sql)
  console.log('SCHEMA_OK')
  const r = await client.query(
    "select tablename from pg_tables where schemaname='public' order by 1"
  )
  console.log(r.rows.map((x) => x.tablename).join(', '))
  await client.end()
}

main().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
