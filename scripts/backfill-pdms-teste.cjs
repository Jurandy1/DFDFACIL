require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')
const { extrairAtributos } = require('./lib/extrair-atributos.cjs')

async function backfillPdm(c, pdm) {
  const { rows } = await c.query(
    'select codigo_item, descricao_completa from itens_material where codigo_pdm=$1 and status_item',
    [pdm]
  )
  if (!rows.length) {
    console.log('PDM', pdm, 'vazio')
    return
  }
  const codes = []
  const attrs = []
  const fornos = []
  const btus = []
  const bocas = []
  for (const row of rows) {
    const p = extrairAtributos(row.descricao_completa)
    codes.push(row.codigo_item)
    attrs.push(JSON.stringify(p.atributos))
    fornos.push(p.tem_forno)
    btus.push(p.capacidade_btu)
    bocas.push(p.qtd_bocas)
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
  const stats = await c.query(
    `select count(*)::int n,
            count(*) filter (where capacidade_btu is not null)::int btu,
            count(*) filter (where tem_forno is not null)::int forno,
            count(*) filter (where qtd_bocas is not null)::int bocas
     from itens_material where codigo_pdm=$1 and status_item`,
    [pdm]
  )
  console.log('PDM', pdm, stats.rows[0])
}

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  for (const pdm of [13768, 1070]) await backfillPdm(c, pdm)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
