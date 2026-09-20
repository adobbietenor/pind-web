-- Phase 2 M2.2 — auto-publishing v1, fixed target (spec.md §8; docs/build-plan.md §6).
--
-- The publish click becomes a nightly job. What changes is who calls
-- admin_publish_gathering, never what publishing means: a gathering reaches the
-- public web only through that function, which mints the slug and tops up the spot
-- poll. Nothing here touches a visibility policy — public_gatherings and
-- public_gathering are still the only door (M2.1), and every table added below is
-- service key only, like moderation_log and import_runs before it.
--
-- Four additions, no behaviour of their own; the rules that use them are in the next
-- migration and in src/publish/.
--
--   1. the loop's settings, on the cities row — never in code (Alex, spec §8);
--   2. publish_mark on a draft: Alex's instruction to the publisher;
--   3. gathering_promotions: who posted a gathering where, recorded when it happens;
--   4. publish_decisions and publish_target_log: why the publisher did what it did.

-- ---------------------------------------------------------------------------
-- 1 · The settings, on the cities row
--
-- Every number the thermostat reads lives here, so another city is a row and a
-- change of mind is an admin form, not a deploy. The starting values are spec §8's.
--
-- publish_lead_days_max is 21 for a reason worth keeping written down: the job fills
-- the city-local week containing today and the two after it, and the furthest point
-- of that third week is at most 20 days away. 21 days of lead therefore always
-- covers exactly the three weeks the job looks at, and the two numbers cannot drift
-- apart into a week the job fills without being able to see all of it.
-- ---------------------------------------------------------------------------

alter table public.cities
  add column publish_target_weekly   smallint not null default 5  check (publish_target_weekly between 0 and 100),
  add column publish_min             smallint not null default 3  check (publish_min between 0 and 100),
  add column publish_max             smallint not null default 20 check (publish_max between 0 and 100),
  add column publish_lead_days_min   smallint not null default 4  check (publish_lead_days_min between 0 and 60),
  add column publish_lead_days_max   smallint not null default 21 check (publish_lead_days_max between 1 and 60),
  add column max_per_venue_per_week  smallint not null default 2  check (max_per_venue_per_week between 1 and 50),
  add column community_slots_weekly  smallint not null default 1  check (community_slots_weekly between 0 and 50),
  add column score_floor             smallint not null default 70 check (score_floor between 0 and 100),
  add column grow_reach              numeric(4, 3) not null default 0.600 check (grow_reach between 0 and 1),
  add column grow_median_pins        smallint not null default 8  check (grow_median_pins >= 0),
  add column shrink_reach            numeric(4, 3) not null default 0.300 check (shrink_reach between 0 and 1),
  add column step_up                 smallint not null default 2  check (step_up between 0 and 50),
  add column step_down               smallint not null default 1  check (step_down between 0 and 50),
  -- Off until M4.5. The weekly adjust still runs and still logs; it just changes
  -- nothing, so switching it on is a checkbox and not new plumbing (Alex, M2.2).
  add column adaptive                boolean not null default false,
  -- The weekly adjust's own window, also §8 rather than code.
  add column adjust_window_days      smallint not null default 14 check (adjust_window_days between 1 and 29),
  add column adjust_min_lead_days    smallint not null default 7  check (adjust_min_lead_days between 0 and 60),
  add column adjust_min_gatherings   smallint not null default 3  check (adjust_min_gatherings between 1 and 100),
  add constraint cities_publish_range check (publish_min <= publish_max),
  add constraint cities_publish_target_in_range
    check (publish_target_weekly between publish_min and publish_max),
  add constraint cities_publish_lead_window check (publish_lead_days_min < publish_lead_days_max),
  add constraint cities_shrink_below_grow check (shrink_reach <= grow_reach);

-- The ceiling of 29 above is not arbitrary and is the whole reason the adjust can
-- read live pins today. Pins are deleted 30 days after a gathering's effective end
-- (decisions.md Part 3), so a trailing window shorter than that still sees every pin
-- of every gathering in it. At 30 days or more the window would quietly start
-- reading gatherings whose pins had already gone and still return a plausible
-- number. src/publish/plan.ts asserts the same thing before it computes anything:
-- the failure has to be loud in both places (Alex, M2.2).
comment on column public.cities.adjust_window_days is
  'Trailing window for the weekly adjust, in days. Must stay under the 30-day pin retention (Part 3) while the adjust reads live pins; M4.5 repoints it at gathering_stats.';
comment on column public.cities.adaptive is
  'The weekly adjust applies its decision. Off until M4.5; it logs either way.';

-- ---------------------------------------------------------------------------
-- 2 · Alex's marks on a draft
--
-- Nothing to do with promotion (see gathering_promotions): this is an instruction to
-- the publisher, and only ever narrows what the ranking would have done anyway.
--   'publish' — goes first, and skips the score floor. Still inside the lead window,
--               still under the per-venue cap, still counted against the target.
--   'never'   — skipped by every future run, for good. Alex can still publish by hand.
-- ---------------------------------------------------------------------------

create type public.publish_mark as enum ('publish', 'never');

alter table public.gatherings add column publish_mark public.publish_mark;

comment on column public.gatherings.publish_mark is
  'Alex''s instruction to the auto-publisher: publish first / never publish. Null is the normal case. Not a record of promotion.';

-- ---------------------------------------------------------------------------
-- 3 · Promotions: who posted this, and where
--
-- "Seeded or not" is the number that decides when the seeding labour can stop and
-- what the publisher's floor rests on, so it cannot be inferred from publish_mark:
-- the two coincide only until the publisher picks a good game and someone posts it
-- anyway, which is the common case (Alex, M2.2). It is recorded at the moment the
-- post happens, by whoever posts it, next to the share link in the admin — not
-- reconciled from a list afterwards.
--
-- Many rows per gathering: three people posting in three places is three facts.
-- A gathering with no row is organic. That bias is deliberate and runs against us —
-- a forgotten tick makes organic reach look better than it is, never worse, so the
-- unseeded number is a floor rather than a measurement.
-- ---------------------------------------------------------------------------

create table public.gathering_promotions (
  id           uuid primary key default gen_random_uuid(),
  gathering_id uuid not null references public.gatherings (id) on delete cascade,
  -- Where it was posted, as whoever posted it would say it: r/leafs, Instagram, a
  -- Discord. Free text on purpose; a fixed list would be wrong within a month.
  channel      text not null check (char_length(btrim(channel)) between 1 and 60),
  note         text check (char_length(note) <= 200),
  promoted_by  text not null check (promoted_by <> ''),
  promoted_at  timestamptz not null default now()
);

create index gathering_promotions_gathering_idx on public.gathering_promotions (gathering_id);
create index gathering_promotions_at_idx on public.gathering_promotions (promoted_at);

-- ---------------------------------------------------------------------------
-- 4a · Why the publisher published what it published
--
-- One row per draft the nightly fill considered — published and skipped alike.
-- Skipped rows are the point as much as published ones: a draft that was passed over
-- because it had been public before has to say so in the panel rather than simply
-- not appear (Alex, M2.2). Only drafts inside the lead window are considered, so the
-- row count is bounded by three weeks of queue, not by the whole 8-week import.
--
-- `reason` is the finished sentence the panel prints, written by the planner and
-- covered by unit tests; the columns beside it are there so the panel can link the
-- gathering and the venue, and so a number can be checked without parsing prose.
-- ---------------------------------------------------------------------------

create type public.publish_outcome as enum ('published', 'skipped');

create table public.publish_decisions (
  id               bigint generated always as identity primary key,
  run_id           bigint references public.import_runs (id) on delete set null,
  city             text not null references public.cities (slug) on delete restrict,
  at               timestamptz not null default now(),
  -- The city-local Monday of the week this draft would have filled.
  week_start       date not null,
  gathering_id     uuid references public.gatherings (id) on delete set null,
  gathering_name   text not null,
  starts_at        timestamptz not null,
  venue_id         uuid references public.venues (id) on delete set null,
  venue_name       text,
  outcome          public.publish_outcome not null,
  -- Machine-readable alongside the sentence, so the panel can group and fold.
  reason_code      text not null check (reason_code <> ''),
  reason           text not null check (reason <> ''),
  -- Published only: which slot of the week's target it filled, and how.
  slot             smallint check (slot > 0),
  slot_kind        text check (slot_kind in ('marked', 'target', 'community')),
  -- Where it came in the week's ranking, and how many it was ranked against.
  rank             smallint check (rank > 0),
  candidates       smallint check (candidates >= 0),
  ai_score         smallint,
  adjustment       smallint,
  final_score      smallint,
  distance_km      numeric(6, 2),
  publish_mark     public.publish_mark,
  target           smallint not null,
  published_before smallint not null,
  constraint publish_decisions_slot_only_when_published
    check ((outcome = 'published') = (slot is not null) and (slot is null) = (slot_kind is null))
);

create index publish_decisions_run_idx on public.publish_decisions (run_id);
create index publish_decisions_at_idx on public.publish_decisions (at);
create index publish_decisions_gathering_idx on public.publish_decisions (gathering_id);

-- ---------------------------------------------------------------------------
-- 4b · Why the target is what it is
--
-- One row per city per calendar week, written whether or not anything moves, with
-- the raw per-gathering rows it was computed from kept in `inputs`. That is what
-- lets M4.5 point the same arithmetic at gathering_stats and confirm on the same
-- weeks that the repoint did not change the answer (Alex, M2.2).
--
-- Seeded and organic are carried side by side and never enter the decision: the
-- decision is the whole population, and the split is there to be read.
-- ---------------------------------------------------------------------------

create table public.publish_target_log (
  id                  bigint generated always as identity primary key,
  run_id              bigint references public.import_runs (id) on delete set null,
  city                text not null references public.cities (slug) on delete restrict,
  at                  timestamptz not null default now(),
  -- The city-local Monday of the week the adjust ran in: one decision per week.
  week_start          date not null,
  decision            text not null check (decision in ('grow', 'shrink', 'hold')),
  -- False while adaptive is off: the row says what it would have done.
  applied             boolean not null,
  reason              text not null check (reason <> ''),
  from_target         smallint not null,
  to_target           smallint not null,
  qualifying          smallint not null,
  reach_rate          numeric(4, 3),
  median_pins         numeric(6, 1),
  seeded_qualifying   smallint not null,
  seeded_reach_rate   numeric(4, 3),
  seeded_median_pins  numeric(6, 1),
  organic_qualifying  smallint not null,
  organic_reach_rate  numeric(4, 3),
  organic_median_pins numeric(6, 1),
  window_days         smallint not null,
  min_lead_days       smallint not null,
  inputs              jsonb not null default '[]'
);

create unique index publish_target_log_one_per_week on public.publish_target_log (city, week_start);
create index publish_target_log_at_idx on public.publish_target_log (at);

-- ---------------------------------------------------------------------------
-- Service key only. Supabase grants anon and authenticated everything on a new
-- table, so revoke it: none of these is a visitor's business, and none has a policy
-- (V12). RLS on regardless, so a missing grant is not the only thing standing there.
-- ---------------------------------------------------------------------------

alter table public.gathering_promotions enable row level security;
alter table public.publish_decisions    enable row level security;
alter table public.publish_target_log   enable row level security;

revoke all on public.gathering_promotions, public.publish_decisions, public.publish_target_log
  from anon, authenticated;
