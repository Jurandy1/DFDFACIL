-- Melhora busca livre: opções por palavra (não fuzzy solto tipo CALÇADEIRA)
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
  ),
  ranked as (
    select
      p.codigo_pdm,
      p.nome_pdm,
      p.codigo_classe,
      (
        select count(*)::bigint
        from itens_material i
        where i.codigo_pdm = p.codigo_pdm and i.status_item
      ) as qtd_itens,
      (
        case
          when p.nome_normalizado = (select t from q) then 100
          when p.nome_normalizado like (select t from q) || ' %' then 90
          when p.nome_normalizado like (select t from q) || '%' then 80
          when p.nome_normalizado ~ ('(^|[ ])' || (select t from q) || '([ ]|$)') then 70
          when p.busca_tsv @@ (select tsq from q) then 40 + ts_rank(p.busca_tsv, (select tsq from q)) * 20
          else similarity(p.nome_normalizado, (select t from q)) * 30
        end
      )::real as score
    from pdms p, q
    where p.status_pdm
      and length((select t from q)) >= 2
      and (
        p.nome_normalizado = (select t from q)
        or p.nome_normalizado like (select t from q) || '%'
        or p.nome_normalizado ~ ('(^|[ ])' || (select t from q) || '([ ]|$)')
        or p.busca_tsv @@ (select tsq from q)
      )
  )
  select *
  from ranked
  where score >= 35
  order by score desc, qtd_itens desc, nome_pdm
  limit lim;
$$;

-- Busca livre em itens (todas as opções que casam com o texto)
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
    (
      case
        when i.nome_normalizado like (select t from q) || '%' then 90
        when i.nome_normalizado ~ ('(^|[ ])' || (select t from q) || '([ ,]|$)') then 75
        when i.busca_tsv @@ (select tsq from q) then 40 + ts_rank(i.busca_tsv, (select tsq from q)) * 25
        else similarity(i.nome_normalizado, (select t from q)) * 25
      end
    )::real as score
  from itens_material i, q
  where i.status_item
    and length((select t from q)) >= 2
    and (
      i.nome_normalizado like (select t from q) || '%'
      or i.nome_normalizado ~ ('(^|[ ])' || (select t from q) || '([ ,]|$)')
      or i.busca_tsv @@ (select tsq from q)
    )
  order by score desc, i.codigo_item
  limit lim;
$$;

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
      when (select t from q) is null then 1::real
      when i.nome_normalizado like (select t from q) || '%' then 90::real
      when i.nome_normalizado ~ ('(^|[ ])' || (select t from q) || '([ ,]|$)') then 75::real
      else greatest(
        coalesce(ts_rank(i.busca_tsv, (select tsq from q)), 0) * 40,
        coalesce(similarity(i.nome_normalizado, (select t from q)), 0) * 30
      )::real
    end as score
  from itens_material i, q
  where i.codigo_pdm = pdm
    and i.status_item
    and (
      (select t from q) is null
      or i.nome_normalizado like '%' || (select t from q) || '%'
      or i.busca_tsv @@ (select tsq from q)
    )
  order by score desc, i.codigo_item
  limit lim;
$$;

grant execute on function buscar_pdms(text, int) to authenticated;
grant execute on function buscar_itens_livre(text, int) to authenticated;
grant execute on function buscar_itens_no_pdm(int, text, int) to authenticated;
