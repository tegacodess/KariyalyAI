-- Application workspace fields.

alter table public.profiles
  add column projects text[] not null default '{}',
  add column certifications text[] not null default '{}';

alter table public.applications
  add column follow_up_on date;
