/**
 * Backfill one-shot: preenche atributos tipados nos ~248k itens.
 * Uso: node scripts/backfill-atributos.cjs [--batch=500] [--limit=N]
 */
require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')
const { extrairAtributos } = require('./lib/extrair-atributos.cjs')

async function main() {
  const batchArg = process.argv.find((a) => a.startsWith('--batch='))
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const BATCH = Number(batchArg?.split('=')[1] || 500)
  const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity

  const url = process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL
  if (!url) {
    console.error('Defina DATABASE_URL em .env.local')
    process.exit(1)
  }

  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const totalRes = await c.query(`select count(*)::int as n from itens_material where status_item`)
  console.log(`Backfill atributos — ${totalRes.rows[0].n} itens ativos, batch=${BATCH}`)

  let lastCodigo = 0
  let processed = 0
  let withBtu = 0
  let withForno = 0
  let withBocas = 0
  const t0 = Date.now()

  while (processed < LIMIT) {
    const take = Math.min(BATCH, Number.isFinite(LIMIT) ? LIMIT - processed : BATCH)
    const { rows } = await c.query(
      `select codigo_item, descricao_completa
       from itens_material
       where status_item and codigo_item > $1
       order by codigo_item
       limit $2`,
      [lastCodigo, take]
    )
    if (!rows.length) break

    const codes = []
    const attrs = []
    const fornos = []
    const btus = []
    const bocas = []

    for (const row of rows) {
      const parsed = extrairAtributos(row.descricao_completa)
      codes.push(row.codigo_item)
      attrs.push(JSON.stringify(parsed.atributos))
      fornos.push(parsed.tem_forno)
      btus.push(parsed.capacidade_btu)
      bocas.push(parsed.qtd_bocas)
      if (parsed.capacidade_btu != null) withBtu++
      if (parsed.tem_forno != null) withForno++
      if (parsed.qtd_bocas != null) withBocas++
      lastCodigo = row.codigo_item
    }

    await c.query(
      `update itens_material i set
         atributos = v.atributos::jsonb,
         tem_forno = v.tem_forno,
         capacidade_btu = v.capacidade_btu,
         qtd_bocas = v.qtd_bocas
       from (
         select
           unnest($1::int[]) as codigo_item,
           unnest($2::text[]) as atributos,
           unnest($3::boolean[]) as tem_forno,
           unnest($4::int[]) as capacidade_btu,
           unnest($5::int[]) as qtd_bocas
       ) v
       where i.codigo_item = v.codigo_item`,
      [codes, attrs, fornos, btus, bocas]
    )

    processed += rows.length
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(
      `  … ${processed} (${elapsed}s) até ${lastCodigo} | btu=${withBtu} forno=${withForno} bocas=${withBocas}`
    )
  }

  console.log(`DONE processed=${processed} btu=${withBtu} forno=${withForno} bocas=${withBocas}`)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
