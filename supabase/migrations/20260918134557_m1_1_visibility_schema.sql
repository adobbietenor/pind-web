-- Phase 1 M1.1 — schema changes the visibility rules need (docs/visibility.md §13).
-- RLS decides which ROWS a role can read, never which columns. Anything that must
-- stay hidden from people who can otherwise read a row therefore moves to its own
-- table with its own rules.

-- ---------------------------------------------------------------------------
-- D1 · people_private — owner-only. Gender is a protected attribute and is never
-- readable per person by anyone else (spec §1, decisions Part 4). Birth year and the
-- 19+ attestation go with it.
-- ---------------------------------------------------------------------------

create table public.people_private (
  person_id              uuid primary key references public.people (id) on delete cascade,
  gender                 public.gender not null,
  include_in_women_only  boolean not null default false,
  birth_year             smallint check (birth_year between 1900 and 2100),
  age_attested_at        timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Offered only to nonbinary people.
  constraint people_private_women_only_nonbinary_only
    check (not include_in_women_only or gender = 'nonbinary')
);

create trigger people_private_set_updated_at before update on public.people_private
  for each row execute function public.set_updated_at();

insert into public.people_private (person_id, gender, include_in_women_only, birth_year, age_attested_at)
select id, gender, include_in_women_only, birth_year, age_attested_at from public.people;

alter table public.people
  drop constraint people_women_only_nonbinary_only,
  drop column gender,
  drop column include_in_women_only,
  drop column birth_year,
  drop column age_attested_at;

alter table public.people_private enable row level security;

-- ---------------------------------------------------------------------------
-- D2 · gathering_group_links — the WhatsApp links leave the public gatherings row.
-- ---------------------------------------------------------------------------

create type public.group_link_kind as enum ('everyone', 'women_only');

create table public.gathering_group_links (
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  kind          public.group_link_kind not null,
  url           text not null check (url ~ '^https://'),
  created_at    timestamptz not null default now(),
  primary key (gathering_id, kind)
);

insert into public.gathering_group_links (gathering_id, kind, url)
select id, 'everyone'::public.group_link_kind, whatsapp_group_url from public.gatherings where whatsapp_group_url is not null
union all
select id, 'women_only'::public.group_link_kind, whatsapp_women_group_url from public.gatherings where whatsapp_women_group_url is not null;

alter table public.gatherings
  drop column whatsapp_group_url,
  drop column whatsapp_women_group_url;

alter table public.gathering_group_links enable row level security;

-- ---------------------------------------------------------------------------
-- V11 · published gatherings. Null = draft (Ticketmaster imports, admin drafts).
-- Only published gatherings are public.
-- ---------------------------------------------------------------------------

alter table public.gatherings add column published_at timestamptz;

-- ---------------------------------------------------------------------------
-- Spot poll: one vote per person per gathering, changeable (Alex, M1.1).
-- gathering_id is carried and pinned to the spot option's gathering by a composite
-- FK, so the rule is a plain primary key.
-- ---------------------------------------------------------------------------

alter table public.gathering_spots
  add constraint gathering_spots_id_gathering_id_key unique (id, gathering_id);

alter table public.spot_votes add column gathering_id uuid;

update public.spot_votes v
set gathering_id = gs.gathering_id
from public.gathering_spots gs
where gs.id = v.gathering_spot_id;

alter table public.spot_votes
  alter column gathering_id set not null,
  drop constraint spot_votes_pkey,
  drop constraint spot_votes_gathering_spot_id_fkey,
  add primary key (gathering_id, person_id),
  add constraint spot_votes_gathering_spot_fkey
    foreign key (gathering_spot_id, gathering_id)
    references public.gathering_spots (id, gathering_id) on delete cascade;

create index spot_votes_gathering_spot_id_idx on public.spot_votes (gathering_spot_id);
