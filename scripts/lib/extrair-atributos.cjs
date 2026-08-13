/**
 * Extração determinística de atributos CATMAT a partir de descricao_completa.
 * Usado por sync-material.cjs e backfill-atributos.cjs
 */

function extrairAtributos(descricaoCompleta) {
  const desc = String(descricaoCompleta || '').toUpperCase()
  const attrs = {}

  let tem_forno = null
  let capacidade_btu = null
  let qtd_bocas = null

  // Forno: SEM FORNO tem precedência (evita falso positivo)
  if (/\bSEM\s+FORNO\b/.test(desc)) {
    tem_forno = false
    attrs.forno = 'SEM FORNO'
  } else if (/\bCOM\s+FORNO\b/.test(desc) || /FORNO\s*\/\s*QUEIMADOR/.test(desc)) {
    tem_forno = true
    attrs.forno = 'COM FORNO'
  } else if (/,\s*FORNO\s*[,/]/.test(desc)) {
    // Ex.: "6 QUEIMADORES DUPLOS, FORNO, CHAPA..."
    tem_forno = true
    attrs.forno = 'COM FORNO'
  }

  // Capacidade: prioriza REFRIGERAÇÃO; senão primeiro BTU genérico
  const refrig =
    desc.match(/CAPACIDADE\s*REFRIG[^:]*:\s*([0-9]{1,3}(?:[.\s]?[0-9]{3})?)\s*BTU/) ||
    desc.match(/CAPACIDADE\s*:\s*([0-9]{1,3}(?:[.\s]?[0-9]{3})?)\s*BTU/)
  const btuAny = desc.match(/([0-9]{1,3}(?:[.\s]?[0-9]{3})?)\s*BTU/)
  const btuRaw = (refrig || btuAny)?.[1]
  if (btuRaw) {
    capacidade_btu = parseInt(String(btuRaw).replace(/[.\s]/g, ''), 10)
    if (Number.isFinite(capacidade_btu) && capacidade_btu > 0) {
      attrs.capacidade_btu = capacidade_btu
    } else {
      capacidade_btu = null
    }
  }

  // Bocas: QUANTIDADE BOCAS: N  |  N BOCAS  |  0N QUEIMADORES
  const bocasMatch =
    desc.match(/QUANTIDADE\s+BOCAS?\s*:\s*(\d+)/) ||
    desc.match(/(?:^|[^0-9])(\d{1,2})\s*BOCAS?\b/) ||
    desc.match(/\b0?(\d{1,2})\s*QUEIMADORES?\b/)
  if (bocasMatch) {
    qtd_bocas = parseInt(bocasMatch[1], 10)
    if (Number.isFinite(qtd_bocas) && qtd_bocas > 0 && qtd_bocas <= 48) {
      attrs.qtd_bocas = qtd_bocas
    } else {
      qtd_bocas = null
    }
  }

  // TIPO: ...
  const tipo = desc.match(/,\s*TIPO(?:\s+[A-ZÀ-Ü ]{0,20})?:\s*([^,]+)/)
  if (tipo) {
    const v = tipo[1].trim().replace(/\s+/g, ' ')
    if (v && !/^N[AÃ]O APLIC/i.test(v)) attrs.tipo = v.slice(0, 80)
  }

  // MODELO: ...
  const modelo = desc.match(/,\s*MODELO(?:\s+[A-ZÀ-Ü ]{0,20})?:\s*([^,]+)/)
  if (modelo) {
    const v = modelo[1].trim().replace(/\s+/g, ' ')
    if (v && !/^N[AÃ]O APLIC/i.test(v)) attrs.modelo = v.slice(0, 80)
  }

  // Tensão
  const tensao =
    desc.match(/,\s*TENS[AÃ]O[^:]*:\s*([^,]+)/) ||
    desc.match(/\b(127\/220\s*V|110\s*V|127\s*V|220\s*V|380\s*V|BIVOLT)\b/)
  if (tensao) {
    attrs.tensao = String(tensao[1]).trim().replace(/\s+/g, ' ').slice(0, 40)
  }

  return {
    atributos: attrs,
    tem_forno,
    capacidade_btu,
    qtd_bocas,
  }
}

module.exports = { extrairAtributos }
