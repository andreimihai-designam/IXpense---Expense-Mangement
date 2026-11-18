-- IXpence: run once in Supabase > SQL Editor. Safe to rerun.
-- Each account owns exactly one versioned financial document.
begin;
create table if not exists public.ixpence_documents (
 user_id uuid primary key references auth.users(id) on delete cascade,
 version bigint not null default 1 check (version > 0),
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 updated_at timestamptz not null default now()
);
alter table public.ixpence_documents enable row level security;
revoke all on public.ixpence_documents from anon, authenticated;
grant select on public.ixpence_documents to authenticated;
drop policy if exists "Read own IXpence document" on public.ixpence_documents;
create policy "Read own IXpence document" on public.ixpence_documents
 for select to authenticated using ((select auth.uid()) = user_id);

-- All writes go through compare-and-swap; stale clients cannot silently overwrite newer data.
create or replace function public.ixpence_save(p_expected_version bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_uid uuid := auth.uid();
 v_version bigint;
 v_updated timestamptz;
begin
 if v_uid is null then raise exception 'IXPENCE_UNAUTHENTICATED'; end if;
 if p_expected_version is null or p_expected_version < 0 then raise exception 'IXPENCE_INVALID_VERSION'; end if;
 if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'version' is distinct from '1'
    or jsonb_typeof(p_payload->'transactions') is distinct from 'array'
    or jsonb_typeof(p_payload->'categories') is distinct from 'array'
    or jsonb_typeof(p_payload->'budgets') is distinct from 'object'
    or octet_length(p_payload::text) > 10485760
 then raise exception 'IXPENCE_INVALID_DOCUMENT'; end if;
 if p_expected_version = 0 then
  insert into public.ixpence_documents(user_id,version,payload)
  values(v_uid,1,p_payload) on conflict(user_id) do nothing
  returning version,updated_at into v_version,v_updated;
 else
  update public.ixpence_documents as d
  set payload=p_payload, version=d.version+1, updated_at=now()
  where d.user_id=v_uid and d.version=p_expected_version
  returning d.version,d.updated_at into v_version,v_updated;
 end if;
 if v_version is null then raise exception 'IXPENCE_CONFLICT'; end if;
 return jsonb_build_object('version',v_version,'updated_at',v_updated);
end;
$$;
revoke all on function public.ixpence_save(bigint,jsonb) from public, anon;
grant execute on function public.ixpence_save(bigint,jsonb) to authenticated;
commit;
