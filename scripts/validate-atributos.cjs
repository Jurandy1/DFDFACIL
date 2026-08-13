/**
 * Valida sanitizer + busca estruturada nos casos de teste.
 */
require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

// Mirror TS sanitizer logic for Node validation
function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}
function sanitizarQueryCATMAT(query) {
  if (!query) return ''
  let q = stripAccents(query.toLowerCase())
  q = q.replace(/(\d+)\s*mil\b/g, (_, n) => `${n}000`)
  q = q.replace(/(\d+)\s*k\b/g, (_, n) => `${n}000`)
  q = q.replace(/(\d+)\.(\d{3})\b/g, '$1$2')
  q = q.replace(/\bcondicionados?\b/g, 'condicionado')
  q = q.replace(/\bbtus?\b|\bbtu\/h\b/g, 'btu')
  q = q.replace(/\bqueimadores?\b/g, 'bocas')
  q = q.replace(/\bbocas?\b/g, 'bocas')
  q = q.replace(/\bfogoes\b/g, 'fogao')
  q = q.replace(/\b(de|da|do|das|dos|para|em|um|uma|o|a|os|as)\b/g, ' ')
  return q.trim().replace(/\s+/g, ' ')
}
function parseSearchIntent(query) {
  const original = stripAccents(query.toLowerCase())
  let q = sanitizarQueryCATMAT(query)
  let tem_forno = null
  if (/\bsem\s+forno\b/.test(original)) tem_forno = false
  else if (/\bcom\s+forno\b/.test(original)) tem_forno = true
  if (tem_forno !== null) {
    q = q.replace(/\b(com|sem)\s+forno\b/g, ' ')
    q = q.replace(/\bforno\b/g, ' ')
  }
  let capacidade_btu = null
  const btu = q.match(/(\d{4,6})\s*btu\b/)
  if (btu) {
    capacidade_btu = parseInt(btu[1], 10)
    q = q.replace(/\d{4,6}\s*btu\b/g, ' ')
  }
  let qtd_bocas = null
  const bocas = q.match(/(\d+)\s*bocas\b/)
  if (bocas) {
    qtd_bocas = parseInt(bocas[1], 10)
    q = q.replace(/\d+\s*bocas\b/g, ' ')
  }
  q = q.replace(/\b(com|sem)\b/g, ' ').trim().replace(/\s+/g, ' ')
  return { termoLimpo: q, tem_forno, capacidade_btu, qtd_bocas }
}

async function main() {
  const cases = [
    'ar condicionados de 9 mil btus',
    'Fogão industrial 4 bocas com forno',
  ]

  console.log('=== Sanitizer / Intent ===')
  for (const q of cases) {
    console.log(q, '→', parseSearchIntent(q))
  }

  const c = new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()

  // Caso 1: AC
  const ac = parseSearchIntent(cases[0])
  console.log('\n=== Caso 1: ar 9 mil btus ===')
  const pdms = await c.query(
    'select codigo_pdm, nome_pdm, qtd_itens, round(score::numeric,1) score from buscar_pdms($1, 5)',
    [ac.termoLimpo]
  )
  console.log('PDMs:', pdms.rows)

  const livre = await c.query(
    'select codigo_item, left(descricao,100) d, round(score::numeric,1) score from buscar_itens_livre($1, 5)',
    [ac.termoLimpo]
  )
  console.log('Livre:', livre.rows)

  const noPdm = await c.query(
    `select codigo_item, left(descricao,110) d, capacidade_btu
     from buscar_itens_no_pdm(13768, $1, 10, null, $2, null) b
     left join itens_material i using (codigo_item)`,
    [ac.termoLimpo, ac.capacidade_btu]
  )
  // buscar_itens_no_pdm doesn't return capacidade_btu - fix query
  const noPdm2 = await c.query(
    `select b.codigo_item, round(b.score::numeric,1) score, left(b.descricao,110) d, i.capacidade_btu, i.tem_forno
     from buscar_itens_no_pdm(13768, $1, 10, null, $2, null) b
     join itens_material i on i.codigo_item = b.codigo_item`,
    [null, ac.capacidade_btu]
  )
  console.log('No PDM 13768 filtrado capacidade_btu=' + ac.capacidade_btu + ':', noPdm2.rows)

  const facAc = await c.query(
    `select chave, valor, qtd from facetas_pdm(13768, 8) where chave in ('CAPACIDADE','TIPO','FORNO')`
  )
  console.log('Facetas AC:', facAc.rows.slice(0, 15))

  // Caso 2: Fogão
  const fog = parseSearchIntent(cases[1])
  console.log('\n=== Caso 2: fogão 4 bocas com forno ===')
  console.log('Intent:', fog)
  const pdmsF = await c.query(
    'select codigo_pdm, nome_pdm, qtd_itens from buscar_pdms($1, 5)',
    [fog.termoLimpo]
  )
  console.log('PDMs:', pdmsF.rows)

  const fogItems = await c.query(
    `select b.codigo_item, round(b.score::numeric,1) score, left(b.descricao,120) d, i.tem_forno, i.qtd_bocas
     from buscar_itens_no_pdm(1070, $1, 15, $2, null, $3) b
     join itens_material i on i.codigo_item = b.codigo_item`,
    [fog.termoLimpo || null, fog.tem_forno, fog.qtd_bocas]
  )
  console.log('Itens filtrados (tem_forno=true, qtd_bocas=4):', fogItems.rows)

  const fogAny = await c.query(
    `select b.codigo_item, left(b.descricao,100) d, i.tem_forno, i.qtd_bocas
     from buscar_itens_no_pdm(1070, null, 10, true, null, null) b
     join itens_material i on i.codigo_item = b.codigo_item`
  )
  console.log('Só tem_forno=true:', fogAny.rows)

  const facF = await c.query(`select chave, valor, qtd from facetas_pdm(1070, 10) where chave in ('FORNO','BOCAS')`)
  console.log('Facetas fogão:', facF.rows)

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
