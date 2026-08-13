-- Normalização de UNIDADE DE MEDIDA em atributos JSONB + facetas/filtro

CREATE OR REPLACE FUNCTION normalizar_sigla_unidade(sigla text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  u text;
  tok text;
BEGIN
  IF sigla IS NULL OR trim(sigla) = '' THEN
    RETURN NULL;
  END IF;

  u := upper(public.immutable_unaccent(trim(sigla)));

  -- Extrai primeiro token conhecido
  tok := (regexp_match(
    u,
    '\m(PACOTES?|PCTE?|CAIXAS?|CXA?|ROLOS?|RL|REMAS?|RM|FARDOS?|FD|UNIDADES?|UNDS?|UNID|UN|METROS?|MTR|MT|M|QUILOGRAMAS?|KG|LITROS?|LT|L|MILILITRO|ML|PARES?|PAR|CONJUNTO|CJ|KIT|GALAO|GALOES|GL|TUBO|TB|BALDE|BD|SACOS?|SC|DUZIA|DZ|CENTO|FOLHAS?)\M'
  ))[1];

  IF tok IS NULL THEN
    tok := regexp_replace(u, '[^A-Z]', '', 'g');
  END IF;

  RETURN CASE tok
    WHEN 'UN' THEN 'UNIDADE'
    WHEN 'UND' THEN 'UNIDADE'
    WHEN 'UNDS' THEN 'UNIDADE'
    WHEN 'UNID' THEN 'UNIDADE'
    WHEN 'UNIDADE' THEN 'UNIDADE'
    WHEN 'UNIDADES' THEN 'UNIDADE'
    WHEN 'PCT' THEN 'PACOTE'
    WHEN 'PCTE' THEN 'PACOTE'
    WHEN 'PACOTE' THEN 'PACOTE'
    WHEN 'PACOTES' THEN 'PACOTE'
    WHEN 'CX' THEN 'CAIXA'
    WHEN 'CXA' THEN 'CAIXA'
    WHEN 'CAIXA' THEN 'CAIXA'
    WHEN 'CAIXAS' THEN 'CAIXA'
    WHEN 'M' THEN 'METRO'
    WHEN 'MT' THEN 'METRO'
    WHEN 'MTR' THEN 'METRO'
    WHEN 'METRO' THEN 'METRO'
    WHEN 'METROS' THEN 'METRO'
    WHEN 'RL' THEN 'ROLO'
    WHEN 'ROLO' THEN 'ROLO'
    WHEN 'ROLOS' THEN 'ROLO'
    WHEN 'RM' THEN 'REMA'
    WHEN 'REMA' THEN 'REMA'
    WHEN 'REMAS' THEN 'REMA'
    WHEN 'FD' THEN 'FARDO'
    WHEN 'FARDO' THEN 'FARDO'
    WHEN 'FARDOS' THEN 'FARDO'
    WHEN 'KG' THEN 'QUILOGRAMA'
    WHEN 'QUILOGRAMA' THEN 'QUILOGRAMA'
    WHEN 'QUILOGRAMAS' THEN 'QUILOGRAMA'
    WHEN 'L' THEN 'LITRO'
    WHEN 'LT' THEN 'LITRO'
    WHEN 'LITRO' THEN 'LITRO'
    WHEN 'LITROS' THEN 'LITRO'
    WHEN 'ML' THEN 'MILILITRO'
    WHEN 'MILILITRO' THEN 'MILILITRO'
    WHEN 'PAR' THEN 'PAR'
    WHEN 'PARES' THEN 'PAR'
    WHEN 'CJ' THEN 'CONJUNTO'
    WHEN 'CONJUNTO' THEN 'CONJUNTO'
    WHEN 'KIT' THEN 'KIT'
    WHEN 'GL' THEN 'GALAO'
    WHEN 'GALAO' THEN 'GALAO'
    WHEN 'GALOES' THEN 'GALAO'
    WHEN 'TB' THEN 'TUBO'
    WHEN 'TUBO' THEN 'TUBO'
    WHEN 'BD' THEN 'BALDE'
    WHEN 'BALDE' THEN 'BALDE'
    WHEN 'SC' THEN 'SACO'
    WHEN 'SACO' THEN 'SACO'
    WHEN 'SACOS' THEN 'SACO'
    WHEN 'DZ' THEN 'DUZIA'
    WHEN 'DUZIA' THEN 'DUZIA'
    WHEN 'CENTO' THEN 'CENTO'
    WHEN 'FOLHA' THEN 'FOLHA'
    WHEN 'FOLHAS' THEN 'FOLHA'
    ELSE NULL
  END;
END;
$$;

-- Extrai unidade da descrição quando coluna estiver vazia
CREATE OR REPLACE FUNCTION extrair_unidade_da_descricao(descricao text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    public.normalizar_sigla_unidade(
      (regexp_match(upper(coalesce(descricao, '')), 'EMBALAGEM\s*:\s*([^,]+)'))[1]
    ),
    public.normalizar_sigla_unidade(
      (regexp_match(upper(coalesce(descricao, '')), 'UNIDADE\s+DE\s+MEDIDA\s*:\s*([^,]+)'))[1]
    ),
    public.normalizar_sigla_unidade(
      (regexp_match(upper(coalesce(descricao, '')), 'UNIDADE\s*:\s*([^,]+)'))[1]
    ),
    public.normalizar_sigla_unidade(
      (regexp_match(upper(coalesce(descricao, '')), 'APRESENTA[CÇ][AÃ]O\s*:\s*([^,]+)'))[1]
    ),
    CASE
      WHEN upper(coalesce(descricao, '')) ~ 'PACOTE\s*(COM|C/|DE|[0-9])' OR upper(coalesce(descricao, '')) ~ '\mPCT\M'
        THEN 'PACOTE'
      WHEN upper(coalesce(descricao, '')) ~ 'CAIXA\s*(COM|C/|DE|[0-9])' OR upper(coalesce(descricao, '')) ~ '\mCX\M'
        THEN 'CAIXA'
      WHEN upper(coalesce(descricao, '')) ~ '\mROLO\M' OR upper(coalesce(descricao, '')) ~ '\mRL\M'
        THEN 'ROLO'
      WHEN upper(coalesce(descricao, '')) ~ '\mREMA\M' OR upper(coalesce(descricao, '')) ~ '\mRESMA\M' OR upper(coalesce(descricao, '')) ~ '\mRM\M'
        THEN 'REMA'
      WHEN upper(coalesce(descricao, '')) ~ '\mFARDO\M'
        THEN 'FARDO'
      WHEN upper(coalesce(descricao, '')) ~ 'COMPRIMENTO\s*:\s*[0-9.,]+\s*M' AND upper(coalesce(descricao, '')) ~ '(FITA|BARBANTE|CORDAO|FITILHO)'
        THEN 'ROLO'
      WHEN upper(coalesce(descricao, '')) ~ '500\s*FOLHAS' OR (upper(coalesce(descricao, '')) ~ '[0-9]+\s*FOLHAS' AND upper(coalesce(descricao, '')) ~ 'PAPEL')
        THEN 'PACOTE'
      ELSE NULL
    END
  );
$$;

-- Backfill em massa: preferir `npm run db:backfill-atributos` (lotes via Node).
-- UPDATE único em 248k linhas estoura statement_timeout no pooler Hobby.

CREATE INDEX IF NOT EXISTS idx_itens_material_unidade
  ON itens_material (unidade_medida)
  WHERE unidade_medida IS NOT NULL;

-- buscar_itens_no_pdm: acrescenta filtro p_unidade (mantém assinatura anterior)
DROP FUNCTION IF EXISTS buscar_itens_no_pdm(int, text, int, boolean, int, int);

CREATE OR REPLACE FUNCTION buscar_itens_no_pdm(
  pdm int,
  termo text DEFAULT NULL,
  lim int DEFAULT 80,
  p_tem_forno boolean DEFAULT NULL,
  p_capacidade_btu int DEFAULT NULL,
  p_qtd_bocas int DEFAULT NULL,
  p_unidade text DEFAULT NULL
)
RETURNS TABLE(
  codigo_item int,
  descricao text,
  unidade text,
  nome_pdm text,
  codigo_classe int,
  codigo_grupo int,
  score real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH q AS (
    SELECT
      CASE WHEN termo IS NULL OR trim(termo) = '' THEN NULL
           ELSE lower(public.immutable_unaccent(trim(termo))) END AS t,
      CASE WHEN termo IS NULL OR trim(termo) = '' THEN NULL
           ELSE public.catmat_norm(termo) END AS t_norm,
      CASE
        WHEN termo IS NULL OR trim(termo) = '' THEN NULL
        WHEN trim(termo) ~ '^[0-9]{4,}' THEN (regexp_match(trim(termo), '^([0-9]{4,})'))[1]
        ELSE NULL
      END AS code_prefix,
      CASE WHEN termo IS NULL OR trim(termo) = '' THEN NULL
           ELSE plainto_tsquery('portuguese', public.immutable_unaccent(trim(termo))) END AS tsq,
      CASE
        WHEN p_unidade IS NULL OR trim(p_unidade) = '' THEN NULL
        ELSE public.normalizar_sigla_unidade(p_unidade)
      END AS und
  ),
  toks AS (
    SELECT coalesce(
      (
        SELECT array_agg(tok) FILTER (WHERE length(tok) >= 2)
        FROM q
        CROSS JOIN LATERAL unnest(string_to_array(coalesce(q.t_norm, ''), ' ')) AS tok
        WHERE q.t_norm IS NOT NULL
      ),
      '{}'::text[]
    ) AS tokens
  )
  SELECT
    i.codigo_item,
    i.descricao_completa AS descricao,
    coalesce(nullif(trim(i.unidade_medida), ''), 'unidade') AS unidade,
    i.nome_pdm,
    i.codigo_classe,
    i.codigo_grupo,
    CASE
      WHEN q.t IS NULL
        AND p_tem_forno IS NULL
        AND p_capacidade_btu IS NULL
        AND p_qtd_bocas IS NULL
        AND q.und IS NULL THEN 1::real
      WHEN q.code_prefix IS NOT NULL AND i.codigo_item::text = q.code_prefix THEN 100::real
      WHEN p_capacidade_btu IS NOT NULL AND i.capacidade_btu = p_capacidade_btu THEN 90::real
      WHEN p_qtd_bocas IS NOT NULL AND i.qtd_bocas = p_qtd_bocas THEN 85::real
      WHEN q.und IS NOT NULL AND (
        i.unidade_medida = q.und
        OR i.atributos->>'UNIDADE DE MEDIDA' = q.und
        OR i.atributos->>'unidade' = q.und
      ) THEN 82::real
      WHEN p_tem_forno IS NOT NULL AND i.tem_forno = p_tem_forno THEN 80::real
      WHEN q.t_norm IS NOT NULL AND public.catmat_norm(i.nome_normalizado) LIKE '%' || q.t_norm || '%' THEN 60::real
      WHEN q.tsq IS NOT NULL AND i.busca_tsv @@ q.tsq THEN (ts_rank(i.busca_tsv, q.tsq) * 100)::real
      ELSE 40::real
    END AS score
  FROM itens_material i
  CROSS JOIN q
  CROSS JOIN toks
  WHERE i.codigo_pdm = pdm
    AND i.status_item
    AND (p_tem_forno IS NULL OR i.tem_forno IS NOT DISTINCT FROM p_tem_forno)
    AND (p_capacidade_btu IS NULL OR i.capacidade_btu = p_capacidade_btu)
    AND (p_qtd_bocas IS NULL OR i.qtd_bocas = p_qtd_bocas)
    AND (
      q.und IS NULL
      OR i.unidade_medida = q.und
      OR i.atributos->>'UNIDADE DE MEDIDA' = q.und
      OR i.atributos->>'unidade' = q.und
    )
    AND (
      q.t IS NULL
      OR (q.code_prefix IS NOT NULL AND i.codigo_item::text = q.code_prefix)
      OR (
        toks.tokens IS NOT NULL
        AND cardinality(toks.tokens) > 0
        AND (
          SELECT bool_and(public.catmat_norm(i.nome_normalizado) LIKE '%' || tok || '%')
          FROM unnest(toks.tokens) AS tok
        )
      )
      OR (q.tsq IS NOT NULL AND i.busca_tsv @@ q.tsq)
      OR (
        q.t IS NULL
        AND (
          p_tem_forno IS NOT NULL
          OR p_capacidade_btu IS NOT NULL
          OR p_qtd_bocas IS NOT NULL
          OR q.und IS NOT NULL
        )
      )
    )
  ORDER BY score DESC, i.codigo_item
  LIMIT lim;
$$;

-- Facetas: inclui UNIDADE DE MEDIDA
CREATE OR REPLACE FUNCTION facetas_pdm(pdm int, lim_por_chave int DEFAULT 16)
RETURNS TABLE(chave text, valor text, qtd bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH structured AS (
    SELECT 'FORNO'::text AS chave,
           CASE WHEN i.tem_forno THEN 'COM FORNO' ELSE 'SEM FORNO' END AS valor,
           count(*)::bigint AS qtd
    FROM itens_material i
    WHERE i.codigo_pdm = pdm AND i.status_item AND i.tem_forno IS NOT NULL
    GROUP BY i.tem_forno

    UNION ALL

    SELECT 'CAPACIDADE',
           i.capacidade_btu::text || ' BTU',
           count(*)::bigint
    FROM itens_material i
    WHERE i.codigo_pdm = pdm AND i.status_item AND i.capacidade_btu IS NOT NULL
    GROUP BY i.capacidade_btu

    UNION ALL

    SELECT 'BOCAS',
           i.qtd_bocas::text || ' BOCAS',
           count(*)::bigint
    FROM itens_material i
    WHERE i.codigo_pdm = pdm AND i.status_item AND i.qtd_bocas IS NOT NULL
    GROUP BY i.qtd_bocas

    UNION ALL

    SELECT 'UNIDADE DE MEDIDA',
           coalesce(
             nullif(i.atributos->>'UNIDADE DE MEDIDA', ''),
             nullif(i.atributos->>'unidade', ''),
             nullif(i.unidade_medida, '')
           ),
           count(*)::bigint
    FROM itens_material i
    WHERE i.codigo_pdm = pdm
      AND i.status_item
      AND coalesce(
        nullif(i.atributos->>'UNIDADE DE MEDIDA', ''),
        nullif(i.atributos->>'unidade', ''),
        nullif(i.unidade_medida, '')
      ) IS NOT NULL
    GROUP BY 2

    UNION ALL

    SELECT
      CASE lower(kv.key)
        WHEN 'tipo' THEN 'TIPO'
        WHEN 'modelo' THEN 'MODELO'
        WHEN 'tensao' THEN 'TENSÃO'
        ELSE NULL
      END,
      left(upper(kv.value), 80),
      count(*)::bigint
    FROM itens_material i
    CROSS JOIN LATERAL jsonb_each_text(coalesce(i.atributos, '{}'::jsonb)) AS kv
    WHERE i.codigo_pdm = pdm
      AND i.status_item
      AND lower(kv.key) IN ('tipo', 'modelo', 'tensao')
      AND length(trim(kv.value)) BETWEEN 1 AND 80
    GROUP BY 1, 2
  ),
  raw AS (
    SELECT
      upper(trim(m[1])) AS chave_raw,
      trim(both ' ,;' from m[2]) AS valor_raw
    FROM itens_material i
    CROSS JOIN LATERAL regexp_matches(
      i.descricao_completa,
      ',\s*([A-Za-zÀ-ÿ0-9 /-]{2,48}):\s*([^,]+)',
      'g'
    ) AS m
    WHERE i.codigo_pdm = pdm
      AND i.status_item
      AND NOT EXISTS (
        SELECT 1 FROM structured s WHERE s.chave IN ('TIPO', 'MODELO', 'TENSÃO')
      )
  ),
  mapped AS (
    SELECT
      CASE
        WHEN chave_raw ~* '^(TIPO)(\s|$)' THEN 'TIPO'
        WHEN chave_raw ~* '^MODELO' THEN 'MODELO'
        WHEN chave_raw ~* '^TENS' THEN 'TENSÃO'
        ELSE NULL
      END AS chave,
      left(regexp_replace(upper(valor_raw), '\s+', ' ', 'g'), 80) AS valor
    FROM raw
  ),
  from_regex AS (
    SELECT chave, valor, count(*)::bigint AS qtd
    FROM mapped
    WHERE chave IS NOT NULL
      AND valor IS NOT NULL
      AND length(valor) BETWEEN 1 AND 80
      AND valor !~ '^(NAO APLIC|NÃO APLIC|S/?N|NULL)'
    GROUP BY chave, valor
  ),
  all_facets AS (
    SELECT * FROM structured WHERE chave IS NOT NULL AND valor IS NOT NULL
    UNION ALL
    SELECT * FROM from_regex
  ),
  ranked AS (
    SELECT
      chave,
      valor,
      qtd,
      row_number() OVER (PARTITION BY chave ORDER BY qtd DESC, valor) AS rn
    FROM all_facets
  )
  SELECT chave, valor, qtd
  FROM ranked
  WHERE rn <= lim_por_chave
  ORDER BY
    CASE chave
      WHEN 'TIPO' THEN 1
      WHEN 'MODELO' THEN 2
      WHEN 'CAPACIDADE' THEN 3
      WHEN 'TENSÃO' THEN 4
      WHEN 'UNIDADE DE MEDIDA' THEN 5
      WHEN 'FORNO' THEN 6
      WHEN 'BOCAS' THEN 7
      ELSE 9
    END,
    qtd DESC,
    valor;
$$;

GRANT EXECUTE ON FUNCTION normalizar_sigla_unidade(text) TO authenticated;
GRANT EXECUTE ON FUNCTION extrair_unidade_da_descricao(text) TO authenticated;
GRANT EXECUTE ON FUNCTION buscar_itens_no_pdm(int, text, int, boolean, int, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION facetas_pdm(int, int) TO authenticated;
