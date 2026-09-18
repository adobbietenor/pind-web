-- Phase 1 M1.3 — schema for the nightly Ticketmaster import, AI vetting and the
-- withdrawn state (decisions.md Part 5).
--
-- As in M1.2, anything admin-only lives in its own table, never on a row the public
-- can read: RLS hides rows, not columns. New tables here are service key only. The
-- visibility side of "withdrawn" is in the next migration; the import and admin
-- functions in the one after.

-- ---------------------------------------------------------------------------
-- Cities: where and how far to search, and how distance adjusts the AI score.
-- Data, not code, so another city is a new row, not a rebuild (Alex, M1.3).
-- ---------------------------------------------------------------------------

alter table public.cities
  add column centre_lat              double precision check (centre_lat between -90 and 90),
  add column centre_lng              double precision check (centre_lng between -180 and 180),
  add column search_radius_km        numeric check (search_radius_km > 0),
  add column core_radius_km          numeric check (core_radius_km >= 0),
  add column distance_penalty_per_km numeric check (distance_penalty_per_km >= 0),
  add column distance_penalty_max    integer check (distance_penalty_max between 0 and 100),
  add column import_weeks            smallint check (import_weeks between 1 and 26);

-- Toronto: Union Station; 30 km, 8 weeks; no adjustment inside 12 km, then −1 per km,
-- capped at −15.
update public.cities
set centre_lat = 43.6453, centre_lng = -79.3806, search_radius_km = 30, core_radius_km = 12,
    distance_penalty_per_km = 1, distance_penalty_max = 15, import_weeks = 8
where slug = 'toronto';

-- ---------------------------------------------------------------------------
-- Venues: coordinates, for distance and for spotting a venue we already have.
-- Venue coordinates are the kind H4 allows. Public, like the rest of the venue row.
-- ---------------------------------------------------------------------------

alter table public.venues
  add column latitude  double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint venues_lat_lng_together check ((latitude is null) = (longitude is null));

-- A venue the importer created is marked for Alex to confirm or merge into one we
-- already have (a rename such as Budweiser Stage → RBC Amphitheatre).
alter table public.venue_external_ids
  add column needs_review boolean not null default false;

-- ---------------------------------------------------------------------------
-- Source rows: the last facts seen (name, start, status, link — never images or
-- descriptions), and since when a listing has been missing.
-- ---------------------------------------------------------------------------

alter table public.gathering_sources
  add column snapshot      jsonb,
  add column missing_since timestamptz;

alter table public.gathering_triage
  add column model text;

alter table public.spot_suggestions
  add column address      text check (char_length(address) <= 200),
  add column evidence_url text check (evidence_url ~ '^https://');

-- ---------------------------------------------------------------------------
-- Withdrawn (Alex, M1.3): a published gathering that is off — even with pins. The
-- public row carries only the timestamp; the reason is admin-only.
-- ---------------------------------------------------------------------------

alter table public.gatherings
  add column withdrawn_at timestamptz,
  add constraint gatherings_withdrawn_is_published check (withdrawn_at is null or published_at is not null);

-- status gains 'withdrawn'. Re-created because a generated column's expression
-- cannot be altered; its index goes with it and is rebuilt.
alter table public.gatherings drop column status;
alter table public.gatherings
  add column status text generated always as (
    case
      when published_at is not null and withdrawn_at is not null then 'withdrawn'
      when published_at is not null then 'published'
      when dismissed_at is not null then 'dismissed'
      else 'draft'
    end
  ) stored;
create index gatherings_status_starts_at_idx on public.gatherings (status, starts_at);

create type public.withdraw_reason as enum ('cancelled', 'postponed', 'takedown', 'other');

create table public.gathering_withdrawals (
  gathering_id  uuid primary key references public.gatherings (id) on delete cascade,
  reason        public.withdraw_reason not null,
  note          text check (char_length(note) <= 500),
  withdrawn_by  text not null check (withdrawn_by <> ''),
  withdrawn_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Flags: a change Ticketmaster reports on a PUBLISHED gathering, for Alex to decide.
-- The importer never changes a published gathering itself. One open flag per
-- gathering per kind; a newer change updates it.
-- ---------------------------------------------------------------------------

create type public.gathering_flag_kind as enum ('date_changed', 'rescheduled', 'postponed', 'cancelled', 'missing');

create table public.gathering_flags (
  id             uuid primary key default gen_random_uuid(),
  gathering_id   uuid not null references public.gatherings (id) on delete cascade,
  kind           public.gathering_flag_kind not null,
  source         public.gathering_source not null check (source <> 'manual'),
  old_starts_at  timestamptz,
  new_starts_at  timestamptz,
  status         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolution     text check (resolution in ('applied', 'withdrawn', 'ignored')),
  resolved_by    text,
  constraint gathering_flags_resolved_together check ((resolved_at is null) = (resolution is null))
);

create unique index gathering_flags_one_open on public.gathering_flags (gathering_id, kind) where resolved_at is null;

-- ---------------------------------------------------------------------------
-- Import runs: the summary Alex sees, the run lock, and the day's AI spend.
-- ---------------------------------------------------------------------------

create table public.import_runs (
  id           bigint generated always as identity primary key,
  source       public.gathering_source not null check (source <> 'manual'),
  trigger      text not null check (trigger in ('cron', 'manual', 'suggest')),
  actor        text not null check (actor <> ''),
  city         text not null references public.cities (slug) on delete restrict,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  counts       jsonb not null default '{}',
  tm_calls     integer not null default 0,
  ai_cost_usd  numeric(10, 6) not null default 0 check (ai_cost_usd >= 0),
  error        text
);

create index import_runs_started_at_idx on public.import_runs (started_at);

alter table public.gathering_withdrawals enable row level security;
alter table public.gathering_flags       enable row level security;
alter table public.import_runs           enable row level security;

-- Service key only: no visitor privileges, no policies (V12).
revoke all on public.gathering_withdrawals, public.gathering_flags, public.import_runs from anon, authenticated;
