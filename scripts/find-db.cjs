require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

const password = encodeURIComponent(process.env.DATABASE_PASSWORD)
const ref = 'ytdkghtirgvvfrcerkjq'
const regions = [
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'eu-west-1',
  'eu-central-1',
  'ap-southeast-1',
]

async function tryConnect(url) {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  await client.connect()
  const r = await client.query('select current_database() as db, current_user as u')
  await client.end()
  return r.rows[0]
}

async function main() {
  for (const region of regions) {
    for (const port of [6543, 5432]) {
      const url = `postgresql://postgres.${ref}:${password}@aws-0-${region}.pooler.supabase.com:${port}/postgres`
      process.stdout.write(`try ${region}:${port} ... `)
      try {
        const row = await tryConnect(url)
        console.log('OK', row)
        console.log('URL_OK', `postgresql://postgres.${ref}:PASSWORD@aws-0-${region}.pooler.supabase.com:${port}/postgres`)
        return
      } catch (e) {
        console.log('FAIL', e.message.split('\n')[0])
      }
    }
  }
  // also try direct with family 6
  const direct = process.env.DATABASE_URL
  process.stdout.write('try direct ipv6 ... ')
  try {
    const row = await tryConnect(direct)
    console.log('OK', row)
  } catch (e) {
    console.log('FAIL', e.message.split('\n')[0])
    process.exit(1)
  }
}

main()
