require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')
const { extrairAtributos } = require('./lib/extrair-atributos.cjs')

async function backfillPdm(c, pdm) {
  const { rows } = await c.query(
    `select codigo_item, descricao_completa, unidade_medida
     from itens_material where codigo_pdm=$1 and status_item`,
    [pdm]
  )
  if (!rows.length) return
  const codes = []
  const attrs = []
  const fornos = []
  const btus = []
  const bocas = []
  const unidades = []
  let withUnd = 0
  for (const row of rows) {
    const p = extrairAtributos(row.descricao_completa, row.unidade_medida)
    codes.push(row.codigo_item)
    attrs.push(JSON.stringify(p.atributos))
    fornos.push(p.tem_forno)
    btus.push(p.capacidade_btu)
    bocas.push(p.qtd_bocas)
    unidades.push(p.unidade_normalizada)
    if (p.unidade_normalizada) withUnd++
  }
  // batch in chunks of 400
  for (let i = 0; i < codes.length; i += 400) {
    const sl = (a) => a.slice(i, i + 400)
    await c.query(
      `update itens_material i set
         atributos = v.atributos::jsonb,
         tem_forno = v.tem_forno,
         capacidade_btu = v.capacidade_btu,
         qtd_bocas = v.qtd_bocas,
         unidade_medida = coalesce(v.unidade_medida, i.unidade_medida)
       from (
         select
           unnest($1::int[]) as codigo_item,
           unnest($2::text[]) as atributos,
           unnest($3::boolean[]) as tem_forno,
           unnest($4::int[]) as capacidade_btu,
           unnest($5::int[]) as qtd_bocas,
           unnest($6::text[]) as unidade_medida
       ) v
       where i.codigo_item = v.codigo_item`,
      [sl(codes), sl(attrs), sl(fornos), sl(btus), sl(bocas), sl(unidades)]
    )
  }
  const nome = await c.query(`select nome_pdm from pdms where codigo_pdm=$1`, [pdm])
  const fac = await c.query(
    `select chave, valor, qtd from facetas_pdm($1, 8) where chave = 'UNIDADE DE MEDIDA'`,
    [pdm]
  )
  console.log(`PDM ${pdm} ${nome.rows[0]?.nome_pdm}: ${rows.length} itens, und=${withUnd}`)
  console.log('  facetas:', fac.rows)
}

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  for (const pdm of [18071, 99, 19746, 13768, 1070]) await backfillPdm(c, pdm)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
