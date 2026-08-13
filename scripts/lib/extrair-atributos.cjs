/**
 * Extração determinística de atributos CATMAT a partir de descricao_completa.
 * Usado por sync-material.cjs e backfill-atributos.cjs
 */

const UNIDADE_MAP = {
  UN: 'UNIDADE',
  UND: 'UNIDADE',
  UNID: 'UNIDADE',
  UNIDADE: 'UNIDADE',
  UNIDADES: 'UNIDADE',
  PCT: 'PACOTE',
  PCTE: 'PACOTE',
  PACOTE: 'PACOTE',
  PACOTES: 'PACOTE',
  CX: 'CAIXA',
  CXA: 'CAIXA',
  CAIXA: 'CAIXA',
  CAIXAS: 'CAIXA',
  M: 'METRO',
  MT: 'METRO',
  MTR: 'METRO',
  METRO: 'METRO',
  METROS: 'METRO',
  RL: 'ROLO',
  ROLO: 'ROLO',
  ROLOS: 'ROLO',
  RM: 'REMA',
  REMA: 'REMA',
  REMAS: 'REMA',
  FD: 'FARDO',
  FARDO: 'FARDO',
  FARDOS: 'FARDO',
  KG: 'QUILOGRAMA',
  QUILOGRAMA: 'QUILOGRAMA',
  QUILOGRAMAS: 'QUILOGRAMA',
  G: 'GRAMA',
  GR: 'GRAMA',
  GRAMA: 'GRAMA',
  L: 'LITRO',
  LT: 'LITRO',
  LITRO: 'LITRO',
  LITROS: 'LITRO',
  ML: 'MILILITRO',
  MILILITRO: 'MILILITRO',
  PAR: 'PAR',
  PARES: 'PAR',
  CJ: 'CONJUNTO',
  CONJUNTO: 'CONJUNTO',
  KIT: 'KIT',
  GL: 'GALAO',
  GALAO: 'GALAO',
  GALAÃO: 'GALAO',
  GALOES: 'GALAO',
  TB: 'TUBO',
  TUBO: 'TUBO',
  BD: 'BALDE',
  BALDE: 'BALDE',
  SC: 'SACO',
  SACO: 'SACO',
  SACOS: 'SACO',
  DZ: 'DUZIA',
  DUZIA: 'DUZIA',
  CENTO: 'CENTO',
  FOLHA: 'FOLHA',
  FOLHAS: 'FOLHA',
}

/** Extrai sigla/palavra-chave de unidade a partir de string livre */
function tokenUnidade(str) {
  if (!str) return null
  const upper = String(str)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .trim()

  // "PACOTE COM 500 FOLHAS" → PACOTE; "CAIXA C/ 100" → CAIXA
  const head = upper.match(
    /\b(PACOTE|PACOTES|PCT|CAIXA|CAIXAS|CX|ROLO|ROLOS|RL|REMA|REMAS|RM|FARDO|FARDOS|FD|UNIDADE|UNIDADES|UND|UNID|UN|METRO|METROS|MTR|M|QUILOGRAMA|KG|LITRO|LITROS|L|MILILITRO|ML|PAR|PARES|CONJUNTO|CJ|KIT|GALAO|GALOES|GL|TUBO|TB|BALDE|BD|SACO|SACOS|SC|DUZIA|DZ|CENTO|FOLHA|FOLHAS)\b/
  )
  if (head) {
    const key = head[1].replace(/[^A-Z]/g, '')
    return UNIDADE_MAP[key] || null
  }

  // Sigla pura: PCT, CX, UN…
  const limpo = upper.replace(/[^A-Z]/g, '')
  if (limpo && UNIDADE_MAP[limpo]) return UNIDADE_MAP[limpo]

  return null
}

function normalizarUnidade(str) {
  if (!str) return null
  return tokenUnidade(str)
}

/**
 * @param {string} descricaoCompleta
 * @param {string|null} [unidadeMedidaCol] — coluna unidade_medida / API
 */
function extrairAtributos(descricaoCompleta, unidadeMedidaCol = null) {
  const desc = String(descricaoCompleta || '').toUpperCase()
  const attrs = {}

  let tem_forno = null
  let capacidade_btu = null
  let qtd_bocas = null
  let unidade_normalizada = null

  // Forno: SEM FORNO tem precedência (evita falso positivo)
  if (/\bSEM\s+FORNO\b/.test(desc)) {
    tem_forno = false
    attrs.forno = 'SEM FORNO'
  } else if (/\bCOM\s+FORNO\b/.test(desc) || /FORNO\s*\/\s*QUEIMADOR/.test(desc)) {
    tem_forno = true
    attrs.forno = 'COM FORNO'
  } else if (/,\s*FORNO\s*[,/]/.test(desc)) {
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

  // —— Unidade de medida / embalagem ——
  // Prioridade: coluna API → EMBALAGEM / UNIDADE DE MEDIDA / UNIDADE / APRESENTAÇÃO na descrição → padrões livres
  const embalagem = desc.match(/,\s*EMBALAGEM\s*:\s*([^,]+)/)
  const undDesc =
    desc.match(/,\s*UNIDADE\s+DE\s+MEDIDA\s*:\s*([^,]+)/) ||
    desc.match(/,\s*UNIDADE\s*:\s*([^,]+)/) ||
    desc.match(/,\s*APRESENTA[CÇ][AÃ]O\s*:\s*([^,]+)/)

  unidade_normalizada =
    normalizarUnidade(unidadeMedidaCol) ||
    (embalagem ? normalizarUnidade(embalagem[1]) : null) ||
    (undDesc ? normalizarUnidade(undDesc[1]) : null) ||
    null

  // Fallbacks textuais comuns em material de expediente
  if (!unidade_normalizada) {
    if (/\bPACOTE\s*(?:COM|C\/|DE|\d+)/.test(desc) || /\bPCT\b/.test(desc)) {
      unidade_normalizada = 'PACOTE'
    } else if (/\bCAIXA\s*(?:COM|C\/|DE|\d+)/.test(desc) || /\bCX\b/.test(desc)) {
      unidade_normalizada = 'CAIXA'
    } else if (/\bROLO\b/.test(desc) || /\bRL\b/.test(desc)) {
      unidade_normalizada = 'ROLO'
    } else if (/\bREMA\b/.test(desc) || /\bRM\b/.test(desc)) {
      unidade_normalizada = 'REMA'
    } else if (/\bFARDO\b/.test(desc)) {
      unidade_normalizada = 'FARDO'
    } else if (/\bSACO\s*(?:COM|C\/|DE|\d+)/.test(desc)) {
      unidade_normalizada = 'SACO'
    }
  }

  // Heurística: fitas / barbantes com comprimento em metros → ROLO
  if (!unidade_normalizada && /\bCOMPRIMENTO\s*:\s*[\d.,]+\s*M\b/.test(desc)) {
    if (/\b(FITA|BARBANTE|CORDAO|CORDÃO|FITILHO)\b/.test(desc)) {
      unidade_normalizada = 'ROLO'
    }
  }

  // Heurística: "500 FOLHAS" / "RESMA" em papel
  if (!unidade_normalizada) {
    if (/\bRESMA\b/.test(desc) || /\b500\s*FOLHAS?\b/.test(desc)) {
      unidade_normalizada = 'REMA'
    } else if (/\b\d+\s*FOLHAS?\b/.test(desc) && /\bPAPEL\b/.test(desc)) {
      unidade_normalizada = 'PACOTE'
    }
  }

  if (unidade_normalizada) {
    attrs['UNIDADE DE MEDIDA'] = unidade_normalizada
    attrs.unidade = unidade_normalizada
  }

  return {
    atributos: attrs,
    tem_forno,
    capacidade_btu,
    qtd_bocas,
    unidade_normalizada,
  }
}

module.exports = {
  extrairAtributos,
  normalizarUnidade,
  UNIDADE_MAP,
}
