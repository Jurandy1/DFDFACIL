require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()

  const item = await c.query(
    `select codigo_item, codigo_pdm, nome_pdm, status_item, left(descricao_completa, 220) as d
     from itens_material where codigo_item = $1`,
    [621109]
  )
  console.log('DB_ITEM', item.rows)

  if (!item.rows[0]) {
    console.log('MISSING_IN_DB')
    await c.end()
    return
  }

  const pdm = item.rows[0].codigo_pdm
  console.log(
    'PDM',
    (
      await c.query('select codigo_pdm, nome_pdm, qtd_itens_ativos from pdms where codigo_pdm=$1', [
        pdm,
      ])
    ).rows[0]
  )

  for (const t of [
    'ar condicionado',
    'aparelho ar condicionado',
    '621109',
    '30000',
    'teto/piso',
    'split teto',
  ]) {
    const pdms = await c.query(
      'select nome_pdm, qtd_itens from buscar_pdms($1, 15)',
      [t]
    )
    const livre = await c.query(
      'select codigo_item, left(descricao,70) d from buscar_itens_livre($1, 15)',
      [t]
    )
    console.log('\nTERM', t)
    console.log(
      ' pdms',
      pdms.rows.map((r) => `${r.nome_pdm}(${r.qtd_itens})`)
    )
    console.log(
      ' livre has 621109?',
      livre.rows.some((r) => r.codigo_item === 621109),
      livre.rows.slice(0, 5)
    )
  }

  const inPdm = await c.query(
    `select codigo_item from buscar_itens_no_pdm($1, null, 200) where codigo_item=621109`,
    [pdm]
  )
  console.log('\nin first 200 of pdm?', inPdm.rows)

  const filtered = await c.query(
    'select codigo_item, left(descricao,90) d from buscar_itens_no_pdm($1,$2,50)',
    [pdm, '30000']
  )
  console.log('filter 30000', filtered.rows)

  const filtered2 = await c.query(
    'select codigo_item, left(descricao,90) d from buscar_itens_no_pdm($1,$2,50)',
    [pdm, 'teto']
  )
  console.log('filter teto', filtered2.rows.slice(0, 8))

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
