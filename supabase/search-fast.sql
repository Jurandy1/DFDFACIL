-- Performance: contagem cacheada + busca sem regex/subselect por linha
alter table pdms add column if not exists qtd_itens_ativos integer not null default 0;

create index if not exists itens_pdm_ativo_idx
  on itens_material (codigo_pdm)
  where status_item;

-- Atualiza contagens (rodar após sync / sob demanda)
create or replace function refresh_pdm_counts()
returns void
language sql
security definer
as $$
  update pdms p
  set qtd_itens_ativos = coalesce(c.n, 0)
  from (
    select codigo_pdm, count(*)::int as n
    from itens_material
    where status_item
    group by codigo_pdm
  ) c
  where p.codigo_pdm = c.codigo_pdm;

  update pdms
  set qtd_itens_ativos = 0
  where codigo_pdm not in (
    select distinct codigo_pdm from itens_material where status_item
  );
$$;

select refresh_pdm_counts();

-- PDMs rápidos: prefixo + full-text (usa GIN), contagem já cacheada
create or replace function buscar_pdms(termo text, lim int default 30)
returns table(codigo_pdm int, nome_pdm text, codigo_classe int, qtd_itens bigint, score real)
language sql
stable
security invoker
as $$
  with q as (
    select
      lower(public.immutable_unaccent(trim(termo))) as t,
      plainto_tsquery('portuguese', public.immutable_unaccent(trim(termo))) as tsq
  )
  select
    p.codigo_pdm,
    p.nome_pdm,
    p.codigo_classe,
    p.qtd_itens_ativos::bigint as qtd_itens,
    (
      case
        when p.nome_normalizado = q.t then 100
        when p.nome_normalizado like q.t || ' %' then 92
        when p.nome_normalizado like q.t || '%' then 85
        when p.busca_tsv @@ q.tsq then 50 + ts_rank(p.busca_tsv, q.tsq) * 30
        else 0
      end
    )::real as score
  from pdms p
  cross join q
  where p.status_pdm
    and length(q.t) >= 2
    and (
      p.nome_normalizado like q.t || '%'
      or p.busca_tsv @@ q.tsq
    )
  order by score desc, p.qtd_itens_ativos desc, p.nome_pdm
  limit lim;
$$;

-- Itens livres: prioriza full-text GIN (rápido em 248k)
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
      plainto_tsquery('portuguese', public.immutable_unaccent(trim(termo))) as tsq
  )
  select
    i.codigo_item,
    i.descricao_completa as descricao,
    coalesce(i.unidade_medida, 'unidade') as unidade,
    i.nome_pdm,
    i.codigo_pdm,
    i.codigo_classe,
    i.codigo_grupo,
    (ts_rank(i.busca_tsv, q.tsq) * 100)::real as score
  from itens_material i
  cross join q
  where i.status_item
    and length(q.t) >= 2
    and i.busca_tsv @@ q.tsq
  order by score desc, i.codigo_item
  limit lim;
$$;

-- Itens no PDM: índice parcial + filtro simples (ilike só se termo)
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
           else plainto_tsquery('portuguese', public.immutable_unaccent(trim(termo))) end as tsq
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
      when i.busca_tsv @@ q.tsq then (ts_rank(i.busca_tsv, q.tsq) * 100)::real
      when i.nome_normalizado like '%' || q.t || '%' then 20::real
      else 0::real
    end as score
  from itens_material i
  cross join q
  where i.codigo_pdm = pdm
    and i.status_item
    and (
      q.t is null
      or i.busca_tsv @@ q.tsq
      or i.nome_normalizado like '%' || q.t || '%'
    )
  order by score desc, i.codigo_item
  limit lim;
$$;

grant execute on function refresh_pdm_counts() to authenticated;
grant execute on function buscar_pdms(text, int) to authenticated;
grant execute on function buscar_itens_livre(text, int) to authenticated;
grant execute on function buscar_itens_no_pdm(int, text, int) to authenticated;
