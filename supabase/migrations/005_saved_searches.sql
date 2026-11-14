-- Saved job searches and deletion support.

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  query text not null check (length(query) <= 100),
  location text not null check (length(location) <= 100),
  mode text not null check (mode in ('', 'remote', 'hybrid', 'on-site')),
  eligibility text not null check (length(eligibility) <= 100),
  cadence text not null check (cadence in ('daily', 'weekly')),
  timezone text not null,
  active boolean not null default true,
  last_run timestamptz,
  jobs jsonb not null default '[]',
  new_count integer not null default 0
);

alter table public.saved_searches enable row level security;

create policy "Manage own searches" on public.saved_searches
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.saved_searches to authenticated;
grant select, update on public.saved_searches to service_role;

create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.saved_searches where user_id = uid;
  delete from public.ai_cache where user_id = uid;
  delete from public.generated_outputs where user_id = uid;
  delete from public.matches where user_id = uid;
  delete from public.applications where user_id = uid;
  delete from public.jobs where user_id = uid;
  delete from public.ai_usage where user_id = uid;
  delete from public.profiles where user_id = uid;
end;
$$;
