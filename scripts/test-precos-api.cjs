/**
 * Smoke test: APIs de preço Compras.gov (621109)
 * Uso: node scripts/test-precos-api.cjs
 */
async function main() {
  const codigo = 621109
  const pdm = 13768

  const siasgUrl =
    `https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial` +
    `?tipo=codigoItemCatalogo&codigo=${codigo}&pagina=1&tamanhoPagina=10&dataCompraInicio=2025-01-01&dataCompraFim=2026-08-13`
  const r1 = await fetch(siasgUrl, { headers: { accept: 'application/json' } })
  const d1 = await r1.json()
  console.log('SIASG', r1.status, 'total', d1.totalRegistros, 'sample preco', d1.resultado?.[0]?.precoUnitario)

  const end = '2026-08-13'
  const start = '2025-08-13'
  const pncpUrl =
    `https://dadosabertos.compras.gov.br/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133` +
    `?codItemCatalogo=${codigo}&materialOuServico=M&pagina=1&tamanhoPagina=10&dataInclusaoPncpInicial=${start}&dataInclusaoPncpFinal=${end}`
  const r2 = await fetch(pncpUrl, { headers: { accept: 'application/json' } })
  const d2 = await r2.json()
  console.log('PNCP', r2.status, 'total', d2.totalRegistros, 'sample', d2.resultado?.[0]?.valorUnitarioEstimado)

  const uUrl = `https://dadosabertos.compras.gov.br/modulo-material/6_consultarMaterialUnidadeFornecimento?codigoPdm=${pdm}&pagina=1&tamanhoPagina=5`
  const d3 = await (await fetch(uUrl, { headers: { accept: 'application/json' } })).json()
  console.log('Unidade PDM', d3.resultado?.[0]?.nomeUnidadeFornecimento)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
