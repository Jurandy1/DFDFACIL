-- Itens livres só dentro dos PDMs que já casaram (bem mais rápido)
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
  ),
  top_pdms as (
    select p.codigo_pdm
    from buscar_pdms(termo, 10) p
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
  join top_pdms tp on tp.codigo_pdm = i.codigo_pdm
  cross join q
  where i.status_item
    and length(q.t) >= 2
    and i.busca_tsv @@ q.tsq
  order by score desc, i.codigo_item
  limit lim;
$$;

grant execute on function buscar_itens_livre(text, int) to authenticated;
