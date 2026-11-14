-- Sponsorship filters and NL/US sponsor evidence support.

alter table public.saved_searches
  add column sponsorship text not null default ''
  check (sponsorship in ('', 'offered', 'evidence'));

create table public.sponsor_search_evidence (
  country text not null check (country in ('NL', 'US')),
  employer text not null check (employer = lower(btrim(employer)) and employer <> ''),
  primary key (country, employer)
);

alter table public.sponsor_search_evidence enable row level security;

revoke all on public.sponsor_search_evidence from anon, authenticated;
grant select, insert, delete on public.sponsor_search_evidence to service_role;
grant select on public.sponsor_register to service_role;

create function public.search_uk_sponsor_names(names text[])
returns setof text
language sql
stable
set search_path = ''
as $$
  select distinct lower(btrim(org_name))
  from public.sponsor_register
  where lower(btrim(org_name)) = any(names);
$$;

create function public.search_other_sponsor_names(names text[])
returns table(employer text, country text)
language sql
stable
set search_path = ''
as $$
  select employer, country
  from public.sponsor_search_evidence
  where employer = any(names);
$$;

revoke all on function public.search_uk_sponsor_names(text[]) from public, anon, authenticated;
revoke all on function public.search_other_sponsor_names(text[]) from public, anon, authenticated;
grant execute on function public.search_uk_sponsor_names(text[]) to service_role;
grant execute on function public.search_other_sponsor_names(text[]) to service_role;
