-- DFD Fácil / StartGov — schema CATMAT + busca + preços + demandas
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- Wrapper immutable para generated columns
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
as $$
  select public.unaccent($1)
$$;

-- Hierarquia CATMAT
create table if not exists grupos_material (
  codigo_grupo integer primary key,
  nome_grupo text not null,
  status_grupo boolean not null default true,
  data_atualizacao timestamptz,
  synced_at timestamptz default now()
);

create table if not exists classes_material (
  codigo_classe integer primary key,
  nome_classe text not null,
  codigo_grupo integer not null references grupos_material(codigo_grupo) on delete cascade,
  status_classe boolean not null default true,
  data_atualizacao timestamptz,
  synced_at timestamptz default now()
);

create table if not exists pdms (
  codigo_pdm integer primary key,
  nome_pdm text not null,
  codigo_classe integer not null references classes_material(codigo_classe) on delete cascade,
  codigo_grupo integer,
  status_pdm boolean not null default true,
  data_atualizacao timestamptz,
  synced_at timestamptz default now(),
  nome_normalizado text generated always as (lower(public.immutable_unaccent(nome_pdm))) stored,
  busca_tsv tsvector generated always as (
    to_tsvector('portuguese', public.immutable_unaccent(coalesce(nome_pdm, '')))
  ) stored
);

create index if not exists pdms_tsv_gin on pdms using gin (busca_tsv);
create index if not exists pdms_nome_trgm on pdms using gin (nome_normalizado gin_trgm_ops);
create index if not exists pdms_classe_idx on pdms (codigo_classe) where status_pdm;

create table if not exists itens_material (
  codigo_item integer primary key,
  codigo_pdm integer not null,
  codigo_classe integer not null,
  codigo_grupo integer not null,
  nome_pdm text,
  nome_classe text,
  nome_grupo text,
  nome_item text not null,
  descricao_completa text not null,
  unidade_medida text,
  status_item boolean not null default true,
  item_sustentavel boolean default false,
  codigo_ncm text,
  aplica_margem_preferencia boolean,
  data_atualizacao timestamptz not null default now(),
  synced_at timestamptz default now(),
  nome_normalizado text generated always as (
    lower(public.immutable_unaccent(descricao_completa))
  ) stored,
  busca_tsv tsvector generated always as (
    to_tsvector(
      'portuguese',
      public.immutable_unaccent(coalesce(nome_item, '') || ' ' || coalesce(descricao_completa, ''))
    )
  ) stored
);

create index if not exists itens_tsv_gin on itens_material using gin (busca_tsv);
create index if not exists itens_nome_trgm on itens_material using gin (nome_normalizado gin_trgm_ops);
create index if not exists itens_pdm on itens_material (codigo_pdm) where status_item;
create index if not exists itens_classe on itens_material (codigo_classe) where status_item;
create index if not exists itens_grupo on itens_material (codigo_grupo) where status_item;
create index if not exists itens_data_atualizacao on itens_material (data_atualizacao);

-- Cache de preços (SIASG + PNCP)
create table if not exists preco_cache (
  codigo_item integer not null,
  fonte text not null check (fonte in ('siasg', 'pncp')),
  preco_unitario numeric(14, 4) not null,
  quantidade numeric(14, 4),
  data_resultado date,
  uasg_origem text not null default '',
  orgao_nome text,
  uf text,
  raw jsonb,
  fetched_at timestamptz default now(),
  primary key (codigo_item, fonte, data_resultado, uasg_origem)
);

create index if not exists preco_cache_item on preco_cache (codigo_item, fetched_at desc);

-- Sync watermark
create table if not exists sync_state (
  entidade text primary key,
  ultima_pagina integer not null default 0,
  watermark timestamptz,
  total_registros integer,
  updated_at timestamptz default now(),
  meta jsonb default '{}'::jsonb
);

-- Demandas (lista pessoal)
create table if not exists demandas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null default 'Minha lista',
  objeto text,
  observacao text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists demandas_user_idx on demandas (user_id);

create table if not exists demanda_itens (
  id uuid primary key default gen_random_uuid(),
  demanda_id uuid not null references demandas(id) on delete cascade,
  codigo_item integer not null,
  descricao text not null,
  unidade text default 'unidade',
  quantidade numeric(14, 4) not null default 1,
  preco_unitario numeric(14, 4),
  preco_fonte text check (
    preco_fonte is null
    or preco_fonte in ('siasg_mediana_12m', 'pncp_mediana_12m', 'manual')
  ),
  ordem integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (demanda_id, codigo_item)
);

create index if not exists demanda_itens_demanda_idx on demanda_itens (demanda_id, ordem);

-- RLS
alter table grupos_material enable row level security;
alter table classes_material enable row level security;
alter table pdms enable row level security;
alter table itens_material enable row level security;
alter table preco_cache enable row level security;
alter table sync_state enable row level security;
alter table demandas enable row level security;
alter table demanda_itens enable row level security;

-- Catálogo: leitura autenticada
drop policy if exists cat_grupos_read on grupos_material;
create policy cat_grupos_read on grupos_material for select to authenticated using (true);

drop policy if exists cat_classes_read on classes_material;
create policy cat_classes_read on classes_material for select to authenticated using (true);

drop policy if exists cat_pdms_read on pdms;
create policy cat_pdms_read on pdms for select to authenticated using (true);

drop policy if exists cat_itens_read on itens_material;
create policy cat_itens_read on itens_material for select to authenticated using (true);

drop policy if exists preco_cache_read on preco_cache;
create policy preco_cache_read on preco_cache for select to authenticated using (true);

drop policy if exists preco_cache_insert on preco_cache;
create policy preco_cache_insert on preco_cache for insert to authenticated with check (true);

drop policy if exists preco_cache_update on preco_cache;
create policy preco_cache_update on preco_cache for update to authenticated using (true);

-- Demandas: só do próprio usuário
drop policy if exists demandas_own on demandas;
create policy demandas_own on demandas for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists demanda_itens_own on demanda_itens;
create policy demanda_itens_own on demanda_itens for all to authenticated
  using (
    exists (
      select 1 from demandas d
      where d.id = demanda_itens.demanda_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from demandas d
      where d.id = demanda_itens.demanda_id and d.user_id = auth.uid()
    )
  );

-- RPC: buscar PDMs
create or replace function buscar_pdms(termo text, lim int default 20)
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
    (
      select count(*)::bigint
      from itens_material i
      where i.codigo_pdm = p.codigo_pdm and i.status_item
    ) as qtd_itens,
    greatest(
      ts_rank(p.busca_tsv, (select tsq from q)),
      similarity(p.nome_normalizado, (select t from q))
    )::real as score
  from pdms p, q
  where p.status_pdm
    and length((select t from q)) >= 2
    and (
      p.busca_tsv @@ (select tsq from q)
      or p.nome_normalizado % (select t from q)
      or p.nome_normalizado like '%' || (select t from q) || '%'
    )
  order by score desc, qtd_itens desc
  limit lim;
$$;

-- RPC: itens no PDM
create or replace function buscar_itens_no_pdm(pdm int, termo text default null, lim int default 50)
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
      else greatest(
        coalesce(ts_rank(i.busca_tsv, (select tsq from q)), 0),
        coalesce(similarity(i.nome_normalizado, (select t from q)), 0)
      )::real
    end as score
  from itens_material i, q
  where i.codigo_pdm = pdm
    and i.status_item
  order by score desc, i.codigo_item
  limit lim;
$$;

-- RPC: unidade mais comum no PDM
create or replace function sugerir_unidade(p_codigo_pdm int)
returns text
language sql
stable
security invoker
as $$
  select coalesce(
    (
      select coalesce(nullif(trim(unidade_medida), ''), 'unidade') as u
      from itens_material
      where codigo_pdm = p_codigo_pdm and status_item
      group by 1
      order by count(*) desc
      limit 1
    ),
    'unidade'
  );
$$;

-- Stats de preço (mediana / p25 / p75 últimos 12 meses)
create or replace function stats_preco_item(p_codigo_item int, p_fonte text default null)
returns table(
  fonte text,
  n bigint,
  mediana numeric,
  p25 numeric,
  p75 numeric,
  minimo numeric,
  maximo numeric
)
language sql
stable
security invoker
as $$
  with base as (
    select
      c.fonte,
      c.preco_unitario::numeric as preco
    from preco_cache c
    where c.codigo_item = p_codigo_item
      and c.data_resultado >= (current_date - interval '12 months')
      and (p_fonte is null or c.fonte = p_fonte)
  )
  select
    b.fonte,
    count(*)::bigint as n,
    percentile_cont(0.5) within group (order by b.preco)::numeric as mediana,
    percentile_cont(0.25) within group (order by b.preco)::numeric as p25,
    percentile_cont(0.75) within group (order by b.preco)::numeric as p75,
    min(b.preco)::numeric as minimo,
    max(b.preco)::numeric as maximo
  from base b
  group by b.fonte;
$$;

-- Garantir demanda do usuário
create or replace function garantir_demanda()
returns demandas
language plpgsql
security invoker
as $$
declare
  d demandas;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into d from demandas where user_id = uid order by created_at asc limit 1;
  if found then
    return d;
  end if;

  insert into demandas (user_id, titulo)
  values (uid, 'Minha lista')
  returning * into d;
  return d;
end;
$$;

grant execute on function buscar_pdms(text, int) to authenticated;
grant execute on function buscar_itens_no_pdm(int, text, int) to authenticated;
grant execute on function sugerir_unidade(int) to authenticated;
grant execute on function stats_preco_item(int, text) to authenticated;
grant execute on function garantir_demanda() to authenticated;
