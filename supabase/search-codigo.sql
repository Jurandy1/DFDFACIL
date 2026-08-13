-- Normaliza texto p/ filtro: 30.000→30000, teto/piso→teto piso
create or replace function catmat_norm(txt text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(public.immutable_unaccent(coalesce(txt, ''))), '[.^]', '', 'g'),
          '[^a-z0-9]+',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

-- Busca direta por código CATMAT
create or replace function buscar_item_por_codigo(p_codigo bigint)
returns table(
  codigo_item int,
  descricao text,
  unidade text,
  nome_pdm text,
  codigo_pdm int,
  codigo_classe int,
  codigo_grupo int,
  score real
)
language sql
stable
security invoker
as $$
  select
    i.codigo_item,
    i.descricao_completa as descricao,
    coalesce(i.unidade_medida, 'unidade') as unidade,
    i.nome_pdm,
    i.codigo_pdm,
    i.codigo_classe,
    i.codigo_grupo,
    100::real as score
  from itens_material i
  where i.codigo_item = p_codigo::int
    and i.status_item
  limit 1;
$$;

-- PDMs: casa por tokens (ex.: "ar condicionado split 30000" ainda acha APARELHO AR CONDICIONADO)
create or replace function buscar_pdms(termo text, lim int default 30)
returns table(codigo_pdm int, nome_pdm text, codigo_classe int, qtd_itens bigint, score real)
language sql
stable
security invoker
as $$
  with q as (
    select
      lower(public.immutable_unaccent(trim(termo))) as t,
      public.catmat_norm(termo) as t_norm,
      plainto_tsquery('portuguese', public.immutable_unaccent(trim(termo))) as tsq
  ),
  toks as (
    select coalesce(array_agg(tok), '{}'::text[]) as tokens
    from (
      select tok
      from q
      cross join lateral unnest(string_to_array(coalesce(q.t_norm, ''), ' ')) as tok
      where length(tok) >= 3
        and tok not in ('de','da','do','das','dos','para','com','sem','e','ou','um','uma','tipo','modelo')
    ) s
  ),
  scored as (
    select
      p.codigo_pdm,
      p.nome_pdm,
      p.codigo_classe,
      p.qtd_itens_ativos::bigint as qtd_itens,
      (
        select count(*)::int
        from unnest(toks.tokens) tok
        where p.nome_normalizado like '%' || tok || '%'
      ) as token_hits,
      cardinality(toks.tokens) as token_n,
      (
        case
          when p.nome_normalizado = q.t then 100
          when p.nome_normalizado like q.t || ' %' then 92
          when p.nome_normalizado like q.t || '%' then 88
          when p.nome_normalizado like '%' || q.t || '%' and p.qtd_itens_ativos >= 50 then 96
          when p.nome_normalizado like '%' || q.t || '%' then 78
          when q.tsq is not null and p.busca_tsv @@ q.tsq then 55 + ts_rank(p.busca_tsv, q.tsq) * 25
          else 0
        end
        + (
          select coalesce(sum(
            case when p.nome_normalizado like '%' || tok || '%' then 14 else 0 end
          ), 0)
          from unnest(toks.tokens) tok
        )
        - case
            when p.nome_normalizado ~ '(pecas|acessorios|filtro|helice|duto|condensador|compressor|componente)'
              then 30
            else 0
          end
      )::real as score
    from pdms p
    cross join q
    cross join toks
    where p.status_pdm
      and length(q.t) >= 2
      and cardinality(toks.tokens) > 0
      and (
        p.nome_normalizado like '%' || q.t || '%'
        or (q.tsq is not null and p.busca_tsv @@ q.tsq)
        or (
          -- tokens do produto no nome do PDM (ignora atributos: split, teto, 30000…)
          (
            select count(*)
            from unnest(toks.tokens) tok
            where p.nome_normalizado like '%' || tok || '%'
              and tok !~ '^[0-9]+$'
              and tok not in (
                'split','inverter','piso','teto','janela','parede','cassete',
                'btu','volt','volts','frio','quente','hi','wall','ciclo'
              )
          ) >= least(
            2,
            greatest(
              1,
              (
                select count(*)::int
                from unnest(toks.tokens) tok
                where tok !~ '^[0-9]+$'
                  and tok not in (
                    'split','inverter','piso','teto','janela','parede','cassete',
                    'btu','volt','volts','frio','quente','hi','wall','ciclo'
                  )
              )
            )
          )
        )
      )
  )
  select codigo_pdm, nome_pdm, codigo_classe, qtd_itens, score
  from scored
  where score > 0 or token_hits > 0
  order by
    token_hits desc,
    score desc,
    qtd_itens desc,
    nome_pdm
  limit lim;
$$;

-- Itens no PDM: filtro tolerante (código, 30000≈30.000, teto piso≈teto/piso, tokens AND)
create or replace function buscar_itens_no_pdm(pdm int, termo text default null, lim int default 80)
returns table(
  codigo_item int,
  descricao text,
  unidade text,
  nome_pdm text,
  codigo_classe int,
  codigo_grupo int,
  score real
)
language sql
stable
security invoker
as $$
  with q as (
    select
      case when termo is null or trim(termo) = '' then null
           else lower(public.immutable_unaccent(trim(termo))) end as t,
      case when termo is null or trim(termo) = '' then null
           else public.catmat_norm(termo) end as t_norm,
      case
        when termo is null or trim(termo) = '' then null
        when trim(termo) ~ '^[0-9]{4,}' then (regexp_match(trim(termo), '^([0-9]{4,})'))[1]
        else null
      end as code_prefix,
      case when termo is null or trim(termo) = '' then null
           else plainto_tsquery('portuguese', public.immutable_unaccent(trim(termo))) end as tsq
  ),
  toks as (
    select coalesce(
      (
        select array_agg(tok) filter (where length(tok) >= 2)
        from q
        cross join lateral unnest(string_to_array(coalesce(q.t_norm, ''), ' ')) as tok
        where q.t_norm is not null
      ),
      '{}'::text[]
    ) as tokens
  )
  select
    i.codigo_item,
    i.descricao_completa as descricao,
    coalesce(i.unidade_medida, 'unidade') as unidade,
    i.nome_pdm,
    i.codigo_classe,
    i.codigo_grupo,
    case
      when q.t is null then 1::real
      when q.code_prefix is not null and i.codigo_item::text = q.code_prefix then 100::real
      when q.t_norm is not null and public.catmat_norm(i.nome_normalizado) like '%' || q.t_norm || '%' then 60::real
      when q.tsq is not null and i.busca_tsv @@ q.tsq then (ts_rank(i.busca_tsv, q.tsq) * 100)::real
      else 40::real
    end as score
  from itens_material i
  cross join q
  cross join toks
  where i.codigo_pdm = pdm
    and i.status_item
    and (
      q.t is null
      or (q.code_prefix is not null and i.codigo_item::text = q.code_prefix)
      or (
        toks.tokens is not null
        and cardinality(toks.tokens) > 0
        and (
          select bool_and(public.catmat_norm(i.nome_normalizado) like '%' || tok || '%')
          from unnest(toks.tokens) as tok
        )
      )
      or (q.tsq is not null and i.busca_tsv @@ q.tsq)
    )
  order by
    case when q.t is null then
      -- Sem filtro: prioriza itens "completos" (com TIPO/MODELO/CAPACIDADE)
      (case when i.nome_normalizado ~ 'tipo:' then 3 else 0 end
       + case when i.nome_normalizado ~ 'modelo:' then 2 else 0 end
       + case when i.nome_normalizado ~ 'capacidade' then 2 else 0 end)
    end desc nulls last,
    case when q.t is null then i.codigo_item end desc nulls last,
    score desc,
    i.codigo_item
  limit lim;
$$;

-- Facetas do PDM a partir de "CHAVE: VALOR" nas descrições CATMAT
create or replace function facetas_pdm(pdm int, lim_por_chave int default 16)
returns table(chave text, valor text, qtd bigint)
language sql
stable
security invoker
as $$
  with raw as (
    select
      upper(trim(m[1])) as chave_raw,
      trim(both ' ,;' from m[2]) as valor_raw
    from itens_material i
    cross join lateral regexp_matches(
      i.descricao_completa,
      ',\s*([A-Za-zÀ-ÿ0-9 /-]{2,48}):\s*([^,]+)',
      'g'
    ) as m
    where i.codigo_pdm = pdm
      and i.status_item
  ),
  mapped as (
    select
      case
        when chave_raw ~* '^(TIPO)(\s|$)' then 'TIPO'
        when chave_raw ~* '^MODELO' then 'MODELO'
        when chave_raw ~* 'CAPACIDADE\s*REFRIG' then 'CAPACIDADE'
        when chave_raw ~* '^CAPACIDADE$' then 'CAPACIDADE'
        when chave_raw ~* '^TENS' then 'TENSÃO'
        when chave_raw ~* 'CARACTER' then 'CARACTERÍSTICAS'
        when chave_raw ~* '^GARANT' then 'GARANTIA'
        else null
      end as chave,
      -- enxuga valor (capa. BTU, tensões)
      case
        when chave_raw ~* 'CAPACIDADE' then
          regexp_replace(upper(valor_raw), '\s+', ' ', 'g')
        else
          left(regexp_replace(upper(valor_raw), '\s+', ' ', 'g'), 80)
      end as valor
    from raw
  ),
  agg as (
    select chave, valor, count(*)::bigint as qtd
    from mapped
    where chave is not null
      and valor is not null
      and length(valor) between 1 and 80
      and valor !~ '^(NAO APLIC|NÃO APLIC|S/?N|NULL)'
    group by chave, valor
  ),
  ranked as (
    select
      chave,
      valor,
      qtd,
      row_number() over (partition by chave order by qtd desc, valor) as rn
    from agg
  )
  select chave, valor, qtd
  from ranked
  where rn <= lim_por_chave
  order by
    case chave
      when 'TIPO' then 1
      when 'MODELO' then 2
      when 'CAPACIDADE' then 3
      when 'TENSÃO' then 4
      when 'CARACTERÍSTICAS' then 5
      else 9
    end,
    qtd desc,
    valor;
$$;

-- Itens livres: prioriza PDM certo + produto configurado (não peças/filtros)
create or replace function buscar_itens_livre(termo text, lim int default 40)
returns table(
  codigo_item int,
  descricao text,
  unidade text,
  nome_pdm text,
  codigo_pdm int,
  codigo_classe int,
  codigo_grupo int,
  score real
)
language sql
stable
security invoker
as $$
  with q as (
    select
      lower(public.immutable_unaccent(trim(termo))) as t,
      public.catmat_norm(termo) as t_norm,
      plainto_tsquery('portuguese', public.immutable_unaccent(trim(termo))) as tsq,
      case
        when trim(termo) ~ '^[0-9]{4,}' then (regexp_match(trim(termo), '^([0-9]{4,})'))[1]
        else null
      end as code_prefix,
      -- tokens extras além do nome genérico (ex.: split, 30000, inverter)
      (
        select coalesce(array_agg(tok) filter (where length(tok) >= 2), '{}'::text[])
        from unnest(string_to_array(public.catmat_norm(termo), ' ')) as tok
      ) as tokens
  ),
  by_code as (
    select
      i.codigo_item,
      i.descricao_completa as descricao,
      coalesce(i.unidade_medida, 'unidade') as unidade,
      i.nome_pdm,
      i.codigo_pdm,
      i.codigo_classe,
      i.codigo_grupo,
      100::real as score
    from itens_material i, q
    where q.code_prefix is not null
      and i.status_item
      and i.codigo_item::text = q.code_prefix
  ),
  top_pdms as (
    select p.codigo_pdm, p.nome_pdm, p.score as pdm_score, row_number() over (order by p.score desc) as rn
    from buscar_pdms(termo, 5) p
    where (select code_prefix from q) is null
  ),
  -- Se a busca é genérica (poucos tokens), amostra só do melhor PDM
  scope as (
    select codigo_pdm, nome_pdm, pdm_score, rn
    from top_pdms
    where rn <= case
      when (select cardinality(tokens) from q) <= 2 then 1
      when (select cardinality(tokens) from q) <= 4 then 2
      else 3
    end
  ),
  by_text as (
    select
      i.codigo_item,
      i.descricao_completa as descricao,
      coalesce(i.unidade_medida, 'unidade') as unidade,
      i.nome_pdm,
      i.codigo_pdm,
      i.codigo_classe,
      i.codigo_grupo,
      (
        s.pdm_score
        + case when s.rn = 1 then 40 else 10 end
        + case when i.nome_normalizado ~ 'tipo:' then 18 else 0 end
        + case when i.nome_normalizado ~ 'modelo:' then 12 else 0 end
        + case when i.nome_normalizado ~ 'capacidade' then 12 else 0 end
        + case when i.nome_normalizado ~ 'inverter' then 6 else 0 end
        + (
          select coalesce(sum(
            case when public.catmat_norm(i.nome_normalizado) like '%' || tok || '%' then 22 else 0 end
          ), 0)
          from unnest(q.tokens) tok
          where length(tok) >= 3
            and tok not in ('ar', 'condicionado', 'aparelho', 'para', 'com', 'de', 'do', 'da')
        )
        + case when i.busca_tsv @@ q.tsq then ts_rank(i.busca_tsv, q.tsq) * 20 else 0 end
      )::real as score
    from itens_material i
    join scope s on s.codigo_pdm = i.codigo_pdm
    cross join q
    where i.status_item
      and length(q.t) >= 2
      and q.code_prefix is null
      and (
        -- busca curta: amostra de itens especificados do PDM principal
        (
          cardinality(q.tokens) <= 2
          and i.nome_normalizado ~ '(tipo:|modelo:|capacidade)'
        )
        -- busca detalhada: todos os tokens relevantes (≥3) devem aparecer no item
        or (
          cardinality(q.tokens) > 2
          and coalesce((
            select bool_and(public.catmat_norm(i.nome_normalizado) like '%' || tok || '%')
            from unnest(q.tokens) tok
            where length(tok) >= 3
              and tok not in ('para', 'com', 'sem', 'aparelho')
          ), false)
        )
      )
  ),
  -- Diversifica amostra: no máx. ~2 por capacidade (evita 20 centrais iguais)
  diversified as (
    select *
    from (
      select
        b.*,
        row_number() over (
          partition by
            b.codigo_pdm,
            coalesce(
              (regexp_match(b.descricao, 'CAPACIDADE[^:]*:\s*([^,]+)', 'i'))[1],
              b.codigo_item::text
            )
          order by b.score desc, b.codigo_item
        ) as rn_cap
      from by_text b
    ) x
    where rn_cap <= 2
  )
  select codigo_item, descricao, unidade, nome_pdm, codigo_pdm, codigo_classe, codigo_grupo, score
  from by_code
  union all
  select codigo_item, descricao, unidade, nome_pdm, codigo_pdm, codigo_classe, codigo_grupo, score
  from diversified
  order by score desc, codigo_item
  limit lim;
$$;

grant execute on function catmat_norm(text) to authenticated;
grant execute on function buscar_item_por_codigo(bigint) to authenticated;
grant execute on function buscar_pdms(text, int) to authenticated;
grant execute on function buscar_itens_no_pdm(int, text, int) to authenticated;
grant execute on function buscar_itens_livre(text, int) to authenticated;
grant execute on function facetas_pdm(int, int) to authenticated;
