/**
 * Sync hierárquico CATMAT → Supabase
 * Uso: node scripts/sync-material.cjs [--only=grupos|classes|pdms|itens] [--max-pages=N]
 */
require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
const { extrairAtributos } = require('./lib/extrair-atributos.cjs')

const BASE = 'https://dadosabertos.compras.gov.br/modulo-material'
const PAGE_SIZE = 500
const COOKIE_FILE = path.join(__dirname, '.sync-cookies.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadCookies() {
  try {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveCookies(cookieHeader) {
  if (!cookieHeader) return
  const jar = loadCookies()
  for (const part of cookieHeader.split(/,(?=[^;]+?=)/)) {
    const kv = part.split(';')[0].trim()
    const i = kv.indexOf('=')
    if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1)
  }
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(jar, null, 2))
}

function cookieHeader() {
  const jar = loadCookies()
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function fetchJson(url, attempt = 0) {
  const headers = {
    accept: 'application/json',
    'user-agent': 'DFDFacil-Sync/1.0',
  }
  const c = cookieHeader()
  if (c) headers.cookie = c

  const res = await fetch(url, { headers })
  const setCookie = res.headers.getSetCookie?.() || []
  if (setCookie.length) saveCookies(setCookie.join(','))
  else {
    const sc = res.headers.get('set-cookie')
    if (sc) saveCookies(sc)
  }

  if (res.status === 429 || res.status === 503) {
    if (attempt >= 5) throw new Error(`HTTP ${res.status} após retries: ${url}`)
    const wait = Math.min(30000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500)
    console.warn(`backoff ${res.status} wait=${wait}ms`)
    await sleep(wait)
    return fetchJson(url, attempt + 1)
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

function dbClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
}

async function getState(client, entidade) {
  const r = await client.query('select * from sync_state where entidade=$1', [entidade])
  return r.rows[0] || null
}

async function setState(client, entidade, fields) {
  await client.query(
    `insert into sync_state (entidade, ultima_pagina, watermark, total_registros, updated_at, meta)
     values ($1,$2,$3,$4,now(),$5::jsonb)
     on conflict (entidade) do update set
       ultima_pagina=excluded.ultima_pagina,
       watermark=coalesce(excluded.watermark, sync_state.watermark),
       total_registros=excluded.total_registros,
       updated_at=now(),
       meta=coalesce(excluded.meta, sync_state.meta)`,
    [
      entidade,
      fields.ultima_pagina ?? 0,
      fields.watermark ?? null,
      fields.total_registros ?? null,
      JSON.stringify(fields.meta ?? {}),
    ]
  )
}

async function syncPaged({
  client,
  entidade,
  pathSuffix,
  mapRow,
  upsertSql,
  maxPages = Infinity,
  resume = true,
  extraQuery = '',
}) {
  let pagina = 1
  if (resume) {
    const st = await getState(client, entidade)
    if (st?.ultima_pagina > 0 && st.meta?.done !== true) {
      pagina = st.ultima_pagina + 1
      console.log(`[${entidade}] retomando página ${pagina}`)
    }
  }

  let maxWatermark = null
  let total = null
  let pages = 0

  while (pages < maxPages) {
    const url = `${BASE}/${pathSuffix}?pagina=${pagina}&tamanhoPagina=${PAGE_SIZE}${extraQuery}`
    const data = await fetchJson(url)
    total = data.totalRegistros ?? total
    const rows = (data.resultado || []).map(mapRow).filter(Boolean)

    if (rows.length) {
      // upsert em lotes
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100)
        await upsertSql(client, chunk)
      }
      for (const r of rows) {
        if (r.data_atualizacao) {
          const d = new Date(r.data_atualizacao)
          if (!maxWatermark || d > maxWatermark) maxWatermark = d
        }
      }
    }

    await setState(client, entidade, {
      ultima_pagina: pagina,
      watermark: maxWatermark ? maxWatermark.toISOString() : null,
      total_registros: total,
      meta: { done: (data.paginasRestantes ?? 0) === 0 },
    })

    pages++
    console.log(
      `[${entidade}] pág ${pagina} +${rows.length} restante=${data.paginasRestantes} total=${total}`
    )

    if ((data.paginasRestantes ?? 0) === 0 || rows.length === 0) break
    pagina++
    await sleep(200)
  }
}

async function upsertGrupos(client, rows) {
  const values = []
  const params = []
  let i = 1
  for (const r of rows) {
    values.push(`($${i++},$${i++},$${i++},$${i++},now())`)
    params.push(r.codigo_grupo, r.nome_grupo, r.status_grupo, r.data_atualizacao)
  }
  await client.query(
    `insert into grupos_material (codigo_grupo,nome_grupo,status_grupo,data_atualizacao,synced_at)
     values ${values.join(',')}
     on conflict (codigo_grupo) do update set
       nome_grupo=excluded.nome_grupo,
       status_grupo=excluded.status_grupo,
       data_atualizacao=excluded.data_atualizacao,
       synced_at=now()`,
    params
  )
}

async function upsertClasses(client, rows) {
  // garantir grupos
  const grupos = new Map()
  for (const r of rows) {
    if (r.codigo_grupo && r.nome_grupo) grupos.set(r.codigo_grupo, r.nome_grupo)
  }
  if (grupos.size) {
    await upsertGrupos(
      client,
      [...grupos.entries()].map(([codigo_grupo, nome_grupo]) => ({
        codigo_grupo,
        nome_grupo,
        status_grupo: true,
        data_atualizacao: null,
      }))
    )
  }

  const values = []
  const params = []
  let i = 1
  for (const r of rows) {
    values.push(`($${i++},$${i++},$${i++},$${i++},$${i++},now())`)
    params.push(
      r.codigo_classe,
      r.nome_classe,
      r.codigo_grupo,
      r.status_classe,
      r.data_atualizacao
    )
  }
  await client.query(
    `insert into classes_material (codigo_classe,nome_classe,codigo_grupo,status_classe,data_atualizacao,synced_at)
     values ${values.join(',')}
     on conflict (codigo_classe) do update set
       nome_classe=excluded.nome_classe,
       codigo_grupo=excluded.codigo_grupo,
       status_classe=excluded.status_classe,
       data_atualizacao=excluded.data_atualizacao,
       synced_at=now()`,
    params
  )
}

async function upsertPdms(client, rows) {
  // classes + grupos mínimos
  const classes = new Map()
  const grupos = new Map()
  for (const r of rows) {
    if (r.codigo_grupo && r.nome_grupo) grupos.set(r.codigo_grupo, r.nome_grupo)
    if (r.codigo_classe && r.nome_classe && r.codigo_grupo) {
      classes.set(r.codigo_classe, {
        codigo_classe: r.codigo_classe,
        nome_classe: r.nome_classe,
        codigo_grupo: r.codigo_grupo,
        status_classe: true,
        data_atualizacao: null,
      })
    }
  }
  if (grupos.size) {
    await upsertGrupos(
      client,
      [...grupos.entries()].map(([codigo_grupo, nome_grupo]) => ({
        codigo_grupo,
        nome_grupo,
        status_grupo: true,
        data_atualizacao: null,
      }))
    )
  }
  if (classes.size) await upsertClasses(client, [...classes.values()])

  const values = []
  const params = []
  let i = 1
  for (const r of rows) {
    values.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},now())`)
    params.push(
      r.codigo_pdm,
      r.nome_pdm,
      r.codigo_classe,
      r.codigo_grupo,
      r.status_pdm,
      r.data_atualizacao
    )
  }
  await client.query(
    `insert into pdms (codigo_pdm,nome_pdm,codigo_classe,codigo_grupo,status_pdm,data_atualizacao,synced_at)
     values ${values.join(',')}
     on conflict (codigo_pdm) do update set
       nome_pdm=excluded.nome_pdm,
       codigo_classe=excluded.codigo_classe,
       codigo_grupo=excluded.codigo_grupo,
       status_pdm=excluded.status_pdm,
       data_atualizacao=excluded.data_atualizacao,
       synced_at=now()`,
    params
  )
}

async function upsertItens(client, rows) {
  // PDMs mínimos (classe/grupo stub se necessário)
  const pdms = new Map()
  const classes = new Map()
  const grupos = new Map()
  for (const r of rows) {
    if (r.codigo_grupo && r.nome_grupo) grupos.set(r.codigo_grupo, r.nome_grupo)
    if (r.codigo_classe && r.nome_classe && r.codigo_grupo) {
      classes.set(r.codigo_classe, {
        codigo_classe: r.codigo_classe,
        nome_classe: r.nome_classe,
        codigo_grupo: r.codigo_grupo,
        status_classe: true,
        data_atualizacao: null,
      })
    }
    if (r.codigo_pdm && r.nome_pdm && r.codigo_classe) {
      pdms.set(r.codigo_pdm, {
        codigo_pdm: r.codigo_pdm,
        nome_pdm: r.nome_pdm,
        codigo_classe: r.codigo_classe,
        codigo_grupo: r.codigo_grupo,
        status_pdm: true,
        data_atualizacao: null,
      })
    }
  }
  if (grupos.size) {
    await upsertGrupos(
      client,
      [...grupos.entries()].map(([codigo_grupo, nome_grupo]) => ({
        codigo_grupo,
        nome_grupo,
        status_grupo: true,
        data_atualizacao: null,
      }))
    )
  }
  if (classes.size) await upsertClasses(client, [...classes.values()])
  if (pdms.size) await upsertPdms(client, [...pdms.values()])

  const values = []
  const params = []
  let i = 1
  for (const r of rows) {
    const parsed = extrairAtributos(r.descricao_completa, r.unidade_medida)
    const unidadeFinal = parsed.unidade_normalizada || r.unidade_medida || null
    values.push(
      `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},now(),$${i++}::jsonb,$${i++},$${i++},$${i++})`
    )
    params.push(
      r.codigo_item,
      r.codigo_pdm,
      r.codigo_classe,
      r.codigo_grupo,
      r.nome_pdm,
      r.nome_classe,
      r.nome_grupo,
      r.nome_item,
      r.descricao_completa,
      unidadeFinal,
      r.status_item,
      r.item_sustentavel,
      r.codigo_ncm,
      r.aplica_margem_preferencia,
      r.data_atualizacao,
      JSON.stringify(parsed.atributos),
      parsed.tem_forno,
      parsed.capacidade_btu,
      parsed.qtd_bocas
    )
  }
  await client.query(
    `insert into itens_material (
      codigo_item,codigo_pdm,codigo_classe,codigo_grupo,
      nome_pdm,nome_classe,nome_grupo,nome_item,descricao_completa,
      unidade_medida,status_item,item_sustentavel,codigo_ncm,
      aplica_margem_preferencia,data_atualizacao,synced_at,
      atributos,tem_forno,capacidade_btu,qtd_bocas
    ) values ${values.join(',')}
    on conflict (codigo_item) do update set
      codigo_pdm=excluded.codigo_pdm,
      codigo_classe=excluded.codigo_classe,
      codigo_grupo=excluded.codigo_grupo,
      nome_pdm=excluded.nome_pdm,
      nome_classe=excluded.nome_classe,
      nome_grupo=excluded.nome_grupo,
      nome_item=excluded.nome_item,
      descricao_completa=excluded.descricao_completa,
      unidade_medida=excluded.unidade_medida,
      status_item=excluded.status_item,
      item_sustentavel=excluded.item_sustentavel,
      codigo_ncm=excluded.codigo_ncm,
      aplica_margem_preferencia=excluded.aplica_margem_preferencia,
      data_atualizacao=excluded.data_atualizacao,
      synced_at=now(),
      atributos=excluded.atributos,
      tem_forno=excluded.tem_forno,
      capacidade_btu=excluded.capacidade_btu,
      qtd_bocas=excluded.qtd_bocas`,
    params
  )
}

function parseArgs() {
  const args = process.argv.slice(2)
  const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1]
  const maxPages = Number(
    (args.find((a) => a.startsWith('--max-pages=')) || '').split('=')[1] || Infinity
  )
  const noResume = args.includes('--no-resume')
  return { only, maxPages: Number.isFinite(maxPages) ? maxPages : Infinity, resume: !noResume }
}

async function main() {
  const { only, maxPages, resume } = parseArgs()
  const client = dbClient()
  await client.connect()
  console.log('conectado ao Supabase')

  const run = async (name, fn) => {
    if (only && only !== name) return
    console.log(`\n=== sync ${name} ===`)
    await fn()
  }

  await run('grupos', () =>
    syncPaged({
      client,
      entidade: 'grupos',
      pathSuffix: '1_consultarGrupoMaterial',
      maxPages,
      resume,
      mapRow: (x) => ({
        codigo_grupo: x.codigoGrupo,
        nome_grupo: x.nomeGrupo,
        status_grupo: !!x.statusGrupo,
        data_atualizacao: x.dataHoraAtualizacao || null,
      }),
      upsertSql: upsertGrupos,
    })
  )

  await run('classes', () =>
    syncPaged({
      client,
      entidade: 'classes',
      pathSuffix: '2_consultarClasseMaterial',
      maxPages,
      resume,
      mapRow: (x) => ({
        codigo_classe: x.codigoClasse,
        nome_classe: x.nomeClasse,
        codigo_grupo: x.codigoGrupo,
        nome_grupo: x.nomeGrupo,
        status_classe: !!x.statusClasse,
        data_atualizacao: x.dataHoraAtualizacao || null,
      }),
      upsertSql: upsertClasses,
    })
  )

  await run('pdms', () =>
    syncPaged({
      client,
      entidade: 'pdms',
      pathSuffix: '3_consultarPdmMaterial',
      maxPages,
      resume,
      mapRow: (x) => ({
        codigo_pdm: x.codigoPdm,
        nome_pdm: x.nomePdm,
        codigo_classe: x.codigoClasse,
        nome_classe: x.nomeClasse,
        codigo_grupo: x.codigoGrupo,
        nome_grupo: x.nomeGrupo,
        status_pdm: !!x.statusPdm,
        data_atualizacao: x.dataHoraAtualizacao || null,
      }),
      upsertSql: upsertPdms,
    })
  )

  await run('itens', () =>
    syncPaged({
      client,
      entidade: 'itens',
      pathSuffix: '4_consultarItemMaterial',
      extraQuery: '&statusItem=true',
      maxPages,
      resume,
      mapRow: (x) => {
        const desc = (x.descricaoItem || '').trim()
        const nome = (x.nomePdm || desc.split(',')[0] || `ITEM ${x.codigoItem}`).trim()
        return {
          codigo_item: x.codigoItem,
          codigo_pdm: x.codigoPdm,
          codigo_classe: x.codigoClasse,
          codigo_grupo: x.codigoGrupo,
          nome_pdm: x.nomePdm,
          nome_classe: x.nomeClasse,
          nome_grupo: x.nomeGrupo,
          nome_item: nome,
          descricao_completa: `${x.codigoItem} - ${desc}`,
          unidade_medida:
            x.unidadeMedida ||
            x.nomeUnidadeMedida ||
            x.siglaUnidadeMedida ||
            x.unidadeFornecimento ||
            null,
          status_item: !!x.statusItem,
          item_sustentavel: !!x.itemSustentavel,
          codigo_ncm: x.codigo_ncm || null,
          aplica_margem_preferencia: x.aplica_margem_preferencia ?? null,
          data_atualizacao: x.dataHoraAtualizacao || new Date().toISOString(),
        }
      },
      upsertSql: upsertItens,
    })
  )

  await client.end()
  console.log('\nSYNC_DONE')
}

main().catch((e) => {
  console.error('SYNC_ERR', e)
  process.exit(1)
})
