-- Fase B: atributos estruturados em itens_material
-- Compatível com schema atual (PK = codigo_item, busca_tsv, codigo_pdm)

ALTER TABLE itens_material
  ADD COLUMN IF NOT EXISTS atributos JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tem_forno BOOLEAN,
  ADD COLUMN IF NOT EXISTS capacidade_btu INTEGER,
  ADD COLUMN IF NOT EXISTS qtd_bocas INTEGER;

CREATE INDEX IF NOT EXISTS idx_itens_material_forno
  ON itens_material (tem_forno)
  WHERE tem_forno IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_itens_material_btu
  ON itens_material (capacidade_btu)
  WHERE capacidade_btu IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_itens_material_bocas
  ON itens_material (qtd_bocas)
  WHERE qtd_bocas IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_itens_material_atributos
  ON itens_material USING gin (atributos);

-- Itens no PDM: mantém assinatura (pdm, termo, lim) + filtros estruturados opcionais
DROP FUNCTION IF EXISTS buscar_itens_no_pdm(int, text, int);

CREATE OR REPLACE FUNCTION buscar_itens_no_pdm(
  pdm int,
  termo text DEFAULT NULL,
  lim int DEFAULT 80,
  p_tem_forno boolean DEFAULT NULL,
  p_capacidade_btu int DEFAULT NULL,
  p_qtd_bocas int DEFAULT NULL
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
           ELSE plainto_tsquery('portuguese', public.immutable_unaccent(trim(termo))) END AS tsq
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
    coalesce(i.unidade_medida, 'unidade') AS unidade,
    i.nome_pdm,
    i.codigo_classe,
    i.codigo_grupo,
    CASE
      WHEN q.t IS NULL
        AND p_tem_forno IS NULL
        AND p_capacidade_btu IS NULL
        AND p_qtd_bocas IS NULL THEN 1::real
      WHEN q.code_prefix IS NOT NULL AND i.codigo_item::text = q.code_prefix THEN 100::real
      WHEN p_capacidade_btu IS NOT NULL AND i.capacidade_btu = p_capacidade_btu THEN 90::real
      WHEN p_qtd_bocas IS NOT NULL AND i.qtd_bocas = p_qtd_bocas THEN 85::real
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
      -- Se só há filtros estruturados (termo vazio após intent), libera todos que passaram no WHERE tipado
      OR (
        q.t IS NULL
        AND (
          p_tem_forno IS NOT NULL
          OR p_capacidade_btu IS NOT NULL
          OR p_qtd_bocas IS NOT NULL
        )
      )
    )
  ORDER BY
    CASE WHEN q.t IS NULL AND p_capacidade_btu IS NULL AND p_qtd_bocas IS NULL AND p_tem_forno IS NULL THEN
      (CASE WHEN i.nome_normalizado ~ 'tipo:' THEN 3 ELSE 0 END
       + CASE WHEN i.nome_normalizado ~ 'modelo:' THEN 2 ELSE 0 END
       + CASE WHEN i.nome_normalizado ~ 'capacidade' THEN 2 ELSE 0 END)
    END DESC NULLS LAST,
    score DESC,
    i.codigo_item
  LIMIT lim;
$$;

-- Facetas: colunas tipadas primeiro + fallback regex para TIPO/MODELO/TENSÃO
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
  -- Fallback regex só se JSONB ainda não tiver TIPO/MODELO/TENSÃO no PDM
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
    SELECT * FROM structured WHERE chave IS NOT NULL
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
      WHEN 'FORNO' THEN 5
      WHEN 'BOCAS' THEN 6
      ELSE 9
    END,
    qtd DESC,
    valor;
$$;

GRANT EXECUTE ON FUNCTION buscar_itens_no_pdm(int, text, int, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION facetas_pdm(int, int) TO authenticated;
