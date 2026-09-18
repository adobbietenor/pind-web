-- Phase 1 M1.2 — schema for drafts from any source, venue matching, AI-suggested
-- spots and the moderation log (decisions.md Part 5, "Gathering sourcing").
--
-- Anything that is admin-only lives in its own table, never on a row the public can
-- read: RLS hides rows, not columns (the M1.1 pattern). Published gatherings, venues
-- and meeting spots are public, so AI scores, source records, venue aliases and
-- unapproved spot suggestions each get a table of their own. Privileges and the
-- venue-maps bucket are in the next migration.

-- ---------------------------------------------------------------------------
-- Cities. Timezones matter: admin forms and public pages show times in the venue's
-- city. Toronto only for now; no city UI.
-- ---------------------------------------------------------------------------

create table public.cities (
  slug      text primary key,
  name      text not null unique,
  timezone  text not null check (timezone <> '') -- IANA name, e.g. America/Toronto
);

insert into public.cities (slug, name, timezone) values ('toronto', 'Toronto', 'America/Toronto');

alter table public.cities enable row level security;

-- ---------------------------------------------------------------------------
-- Venues: city, static map image, and the order spots are offered in.
-- ---------------------------------------------------------------------------

alter table public.venues
  add column city text not null default 'toronto' references public.cities (slug) on delete restrict,
  -- Object name in the public venue-maps bucket. Never a person (H1).
  add column map_image_path text;

-- The spot poll takes a venue's first 3 active spots, in this order.
alter table public.meeting_spots
  add column sort_order smallint not null default 0;

-- Exact matches for importers, e.g. Ticketmaster's venue id.
create table public.venue_external_ids (
  source       public.gathering_source not null check (source <> 'manual'),
  external_id  text not null check (external_id <> ''),
  venue_id     uuid not null references public.venues (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (source, external_id)
);

create index venue_external_ids_venue_id_idx on public.venue_external_ids (venue_id);

-- Other names a venue goes by. alias_key is the name lower-cased with spaces
-- collapsed, which is what importers match on.
create table public.venue_aliases (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete cascade,
  alias       text not null check (char_length(btrim(alias)) between 1 and 200),
  alias_key   text generated always as (lower(btrim(regexp_replace(alias, '\s+', ' ', 'g')))) stored,
  created_at  timestamptz not null default now(),
  unique (venue_id, alias_key)
);

create index venue_aliases_alias_key_idx on public.venue_aliases (alias_key);

-- AI-proposed meeting spots awaiting approval. Approving creates the real
-- meeting_spots row (possibly edited); until then nothing public changes (H5).
create type public.suggestion_status as enum ('pending', 'approved', 'rejected');

create table public.spot_suggestions (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  description      text,
  reason           text,
  status           public.suggestion_status not null default 'pending',
  meeting_spot_id  uuid references public.meeting_spots (id) on delete set null,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  constraint spot_suggestions_decided_at_matches_status
    check ((status = 'pending') = (decided_at is null))
);

create index spot_suggestions_venue_id_idx on public.spot_suggestions (venue_id);

-- ---------------------------------------------------------------------------
-- Gatherings: draft / published / dismissed.
--
-- published_at stays the single thing that makes a gathering public — every M1.1
-- policy and gathering_counts key off it, so none of them change. status is derived
-- from the two timestamps so it can never disagree with them.
-- ---------------------------------------------------------------------------

-- One link, tickets or event info; optional because many events are free.
alter table public.gatherings rename column ticket_url to event_url;

-- The map image belongs to the venue now.
alter table public.gatherings drop column map_image_path;

alter table public.gatherings
  add column is_free boolean not null default false,
  -- What the source called the venue, kept until it is matched to a venue.
  add column venue_name_raw text,
  add column dismissed_at timestamptz,
  add column merged_into_id uuid references public.gatherings (id) on delete set null,
  -- Drafts may not have a venue yet (an AI find at a venue we don't know).
  alter column venue_id drop not null,
  add constraint gatherings_published_has_venue check (published_at is null or venue_id is not null),
  add constraint gatherings_published_or_dismissed check (published_at is null or dismissed_at is null),
  add constraint gatherings_merged_is_dismissed check (merged_into_id is null or dismissed_at is not null),
  add constraint gatherings_not_merged_into_self check (merged_into_id <> id);

alter table public.gatherings
  add column status text generated always as (
    case
      when published_at is not null then 'published'
      when dismissed_at is not null then 'dismissed'
      else 'draft'
    end
  ) stored;

create index gatherings_status_starts_at_idx on public.gatherings (status, starts_at);

-- Every source that found a gathering. One row per (source, external id), kept for
-- dismissed and merged drafts too: that is what stops an import re-creating an event
-- Alex already dismissed. Merging moves the loser's rows to the survivor. Manual
-- entries have none.
create table public.gathering_sources (
  id             uuid primary key default gen_random_uuid(),
  gathering_id   uuid not null references public.gatherings (id) on delete cascade,
  source         public.gathering_source not null check (source <> 'manual'),
  external_id    text check (external_id <> ''),
  urls           text[] not null default '{}',
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create unique index gathering_sources_external_key
  on public.gathering_sources (source, external_id) where external_id is not null;
create index gathering_sources_gathering_id_idx on public.gathering_sources (gathering_id);

insert into public.gathering_sources (gathering_id, source, external_id)
select id, 'ticketmaster', ticketmaster_id from public.gatherings where ticketmaster_id is not null;

alter table public.gatherings drop column ticketmaster_id;

-- The AI's vetting of a draft: a 0–100 score and a one-line reason. Admin only.
create table public.gathering_triage (
  gathering_id  uuid primary key references public.gatherings (id) on delete cascade,
  score         smallint check (score between 0 and 100),
  reason        text check (char_length(reason) <= 300),
  scored_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Moderation log: who did what, when (decisions Part 3: moderation decisions kept
-- 12 months). actor is the admin's Cloudflare Access email. No foreign keys, so the
-- record outlives a deleted pin or gathering.
-- ---------------------------------------------------------------------------

create table public.moderation_log (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor         text not null check (actor <> ''),
  action        text not null check (action <> ''),
  gathering_id  uuid,
  person_id     uuid,
  pin_id        uuid,
  venue_id      uuid,
  note          text
);

create index moderation_log_at_idx on public.moderation_log (at);

alter table public.venue_external_ids enable row level security;
alter table public.venue_aliases      enable row level security;
alter table public.spot_suggestions   enable row level security;
alter table public.gathering_sources  enable row level security;
alter table public.gathering_triage   enable row level security;
alter table public.moderation_log     enable row level security;
