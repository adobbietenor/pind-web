-- 20260918033807_initial_schema.sql — Phase 0 foundations.
-- Every object in spec.md §1 plus the Test 0 tables (§2).
-- RLS is enabled on every table with NO policies: until the policies milestone,
-- anon and authenticated can read and write nothing (H11).
-- Counting rules (3 members before spot_set, 8 seats, 3 gathering spots, +1 slots)
-- and time-driven transitions are deferred to the lifecycle milestone.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.gender as enum ('woman', 'man', 'nonbinary', 'undisclosed');
create type public.photo_status as enum ('pending', 'approved', 'rejected');
create type public.gathering_source as enum ('ticketmaster', 'manual');
create type public.contact_kind as enum ('email', 'sms');
create type public.crew_state as enum ('forming', 'spot_set', 'live', 'done', 'dissolved');
create type public.join_request_status as enum ('pending', 'approved', 'declined');
create type public.message_kind as enum ('system', 'user', 'arrival');
create type public.confirmation_kind as enum ('we_met', 'keep_in_touch');
create type public.report_target as enum ('person', 'crew', 'message');
create type public.report_reason as enum ('uncomfortable', 'not_who_they_said', 'under_19', 'spam');
create type public.report_status as enum ('open', 'auto_hidden', 'actioned', 'dismissed');
create type public.outbound_kind as enum ('threshold', 'survey');
create type public.survey_met as enum ('none', '1_2', '3_5', '6_plus');
create type public.survey_would_have_gone as enum ('yes', 'no', 'wasnt_going');

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

create table public.venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  created_at  timestamptz not null default now()
);

-- The venue's curated list (H5). There is no free-text address anywhere.
create table public.meeting_spots (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete restrict,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (venue_id, name)
);

-- ---------------------------------------------------------------------------
-- Gatherings
-- ---------------------------------------------------------------------------

create table public.gatherings (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  starts_at                 timestamptz not null,
  ends_at                   timestamptz check (ends_at > starts_at),
  venue_id                  uuid not null references public.venues (id) on delete restrict,
  ticket_url                text,
  map_image_path            text,
  featured                  boolean not null default false,
  source                    public.gathering_source not null default 'manual',
  ticketmaster_id           text unique,
  whatsapp_group_url        text,
  whatsapp_women_group_url  text,
  threshold_notified_at     timestamptz,
  created_at                timestamptz not null default now()
);

create index gatherings_starts_at_idx on public.gatherings (starts_at);

-- Effective end: ends_at, or starts_at + 180 minutes. Everything time-driven after
-- a gathering keys off this, never starts_at. Callable as g.effective_end.
create function public.effective_end(g public.gatherings) returns timestamptz
language sql stable set search_path = '' as $$
  select coalesce(g.ends_at, g.starts_at + interval '180 minutes');
$$;

-- Test 0 spot poll (T6): the gathering's 3 spot + time options.
create table public.gathering_spots (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  spot_id       uuid not null references public.meeting_spots (id) on delete restrict,
  meet_at       timestamptz not null,
  unique (gathering_id, spot_id)
);

-- ---------------------------------------------------------------------------
-- Lookups
-- ---------------------------------------------------------------------------

create table public.neighbourhoods (
  slug        text primary key,
  name        text not null unique,
  sort_order  smallint not null unique
);

-- App only; never collected in Test 0.
create table public.tags (
  slug        text primary key,
  name        text not null unique,
  sort_order  smallint not null unique
);

insert into public.neighbourhoods (slug, name, sort_order) values
  ('liberty-village',   'Liberty Village',    1),
  ('king-west',         'King West',          2),
  ('cityplace',         'CityPlace',          3),
  ('fort-york',         'Fort York',          4),
  ('queen-west',        'Queen West',         5),
  ('trinity-bellwoods', 'Trinity Bellwoods',  6),
  ('ossington',         'Ossington',          7),
  ('dundas-west',       'Dundas West',        8),
  ('little-portugal',   'Little Portugal',    9),
  ('little-italy',      'Little Italy',      10),
  ('kensington-market', 'Kensington Market', 11),
  ('the-annex',         'The Annex',         12),
  ('harbourfront',      'Harbourfront',      13),
  ('st-lawrence',       'St. Lawrence',      14),
  ('church-wellesley',  'Church-Wellesley',  15),
  ('yorkville',         'Yorkville',         16),
  ('leslieville',       'Leslieville',       17),
  ('riverside',         'Riverside',         18),
  ('the-danforth',      'The Danforth',      19),
  ('junction',          'Junction',          20),
  ('roncesvalles',      'Roncesvalles',      21),
  ('high-park',         'High Park',         22),
  ('parkdale',          'Parkdale',          23),
  ('leaside',           'Leaside',           24),
  ('midtown',           'Midtown',           25),
  ('north-york',        'North York',        26),
  ('scarborough',       'Scarborough',       27),
  ('etobicoke',         'Etobicoke',         28),
  ('east-york',         'East York',         29),
  ('outside-toronto',   'Outside Toronto',   30);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- One row per human, web (Test 0 anonymous sign-in) and app alike.
-- gender is never exposed per-person; only in the aggregate chip and women-only
-- eligibility. Only birth_year is kept after the 19+ check.
create table public.people (
  id                     uuid primary key default gen_random_uuid(),
  auth_user_id           uuid unique references auth.users (id) on delete set null,
  first_name             text not null check (char_length(btrim(first_name)) between 1 and 40),
  last_initial           text check (char_length(last_initial) = 1),
  birth_year             smallint check (birth_year between 1900 and 2100),
  age_attested_at        timestamptz not null,
  gender                 public.gender not null,
  include_in_women_only  boolean not null default false,
  photo_path             text,
  photo_status           public.photo_status not null default 'pending',
  instagram_handle       text check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  neighbourhood          text references public.neighbourhoods (slug) on delete restrict,
  hidden_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Offered only to nonbinary people.
  constraint people_women_only_nonbinary_only
    check (not include_in_women_only or gender = 'nonbinary'),
  -- Test 0: photo or Instagram handle (Q2). The app requires a photo on top.
  constraint people_photo_or_instagram
    check (photo_path is not null or instagram_handle is not null)
);

create trigger people_set_updated_at before update on public.people
  for each row execute function public.set_updated_at();

create table public.person_tags (
  person_id  uuid not null references public.people (id) on delete cascade,
  tag        text not null references public.tags (slug) on delete restrict,
  primary key (person_id, tag)
);

-- ---------------------------------------------------------------------------
-- Pins
-- ---------------------------------------------------------------------------

create table public.pins (
  id               uuid primary key default gen_random_uuid(),
  gathering_id     uuid not null references public.gatherings (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  party_total      smallint not null default 1 check (party_total between 1 and 10),
  open_to_meeting  boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (gathering_id, person_id)
);

create index pins_person_id_idx on public.pins (person_id);

create trigger pins_set_updated_at before update on public.pins
  for each row execute function public.set_updated_at();

-- +1 claims (T10, Q1). A +1 is not a person and consents to nothing until claimed.
create table public.pin_friends (
  id                uuid primary key default gen_random_uuid(),
  pin_id            uuid not null references public.pins (id) on delete cascade,
  claim_token_hash  text not null unique,
  first_name        text check (char_length(btrim(first_name)) between 1 and 40),
  age_attested_at   timestamptz,
  claimed_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint pin_friends_claim_complete
    check (claimed_at is null or (first_name is not null and age_attested_at is not null))
);

create index pin_friends_pin_id_idx on public.pin_friends (pin_id);

-- Contact details live apart from every row other people can ever read.
-- Owned by a person, or by a claimed +1.
create table public.contact_points (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid references public.people (id) on delete cascade,
  pin_friend_id  uuid references public.pin_friends (id) on delete cascade,
  kind           public.contact_kind not null,
  value          text not null,
  opted_out_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint contact_points_one_owner check (num_nonnulls(person_id, pin_friend_id) = 1)
);

create unique index contact_points_person_kind_key
  on public.contact_points (person_id, kind) where person_id is not null;
create unique index contact_points_pin_friend_kind_key
  on public.contact_points (pin_friend_id, kind) where pin_friend_id is not null;

create table public.spot_votes (
  gathering_spot_id  uuid not null references public.gathering_spots (id) on delete cascade,
  person_id          uuid not null references public.people (id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (gathering_spot_id, person_id)
);

-- ---------------------------------------------------------------------------
-- Crews
-- ---------------------------------------------------------------------------

-- forming → spot_set → live → done, or forming → dissolved. No owner (Q4).
-- Rows are never deleted.
create table public.crews (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete restrict,
  state         public.crew_state not null default 'forming',
  women_only    boolean not null default false,
  spot_id       uuid references public.meeting_spots (id) on delete restrict,
  meet_at       timestamptz,
  sibling_of    uuid references public.crews (id) on delete set null,
  dissolved_at  timestamptz,
  hidden_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, gathering_id),
  constraint crews_spot_matches_state check (
    (state in ('forming', 'dissolved') and spot_id is null and meet_at is null)
    or (state in ('spot_set', 'live', 'done') and spot_id is not null and meet_at is not null)
  ),
  constraint crews_dissolved_at_matches_state
    check ((state = 'dissolved') = (dissolved_at is not null))
);

create index crews_gathering_id_idx on public.crews (gathering_id);

create trigger crews_set_updated_at before update on public.crews
  for each row execute function public.set_updated_at();

-- gathering_id is carried (and pinned to the crew's by the composite FK) so that
-- "one crew per person per gathering" is a plain partial unique index.
create table public.crew_members (
  id            uuid primary key default gen_random_uuid(),
  crew_id       uuid not null,
  gathering_id  uuid not null,
  person_id     uuid not null references public.people (id) on delete cascade,
  seats         smallint not null default 1 check (seats between 1 and 2),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  arrived_at    timestamptz,
  arrival_note  text check (char_length(btrim(arrival_note)) between 1 and 80),
  foreign key (crew_id, gathering_id)
    references public.crews (id, gathering_id) on delete cascade,
  -- "I'm here" requires a line of text (Q7).
  constraint crew_members_arrival_needs_note
    check ((arrived_at is null) = (arrival_note is null))
);

create unique index crew_members_one_active_crew_per_gathering
  on public.crew_members (gathering_id, person_id) where left_at is null;
create index crew_members_crew_id_idx on public.crew_members (crew_id);

create table public.crew_proposals (
  id           uuid primary key default gen_random_uuid(),
  crew_id      uuid not null references public.crews (id) on delete cascade,
  spot_id      uuid not null references public.meeting_spots (id) on delete restrict,
  meet_at      timestamptz not null,
  proposed_by  uuid references public.people (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (crew_id, spot_id, meet_at)
);

create table public.crew_proposal_votes (
  proposal_id  uuid not null references public.crew_proposals (id) on delete cascade,
  person_id    uuid not null references public.people (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (proposal_id, person_id)
);

-- Declines are silent to the requester (Q4).
create table public.crew_join_requests (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews (id) on delete cascade,
  person_id   uuid not null references public.people (id) on delete cascade,
  seats       smallint not null default 1 check (seats between 1 and 2),
  status      public.join_request_status not null default 'pending',
  decided_by  uuid references public.people (id) on delete set null,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  constraint crew_join_requests_decided_at_matches_status
    check ((status = 'pending') = (decided_at is null))
);

create unique index crew_join_requests_one_pending
  on public.crew_join_requests (crew_id, person_id) where status = 'pending';

-- The crew thread (A14). Its open / read-only / deleted states derive from the
-- gathering's effective end (Q11); there is no separate thread table.
create table public.crew_messages (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews (id) on delete cascade,
  author_id   uuid references public.people (id) on delete set null,
  kind        public.message_kind not null,
  body        text not null check (char_length(body) between 1 and 2000),
  hidden_at   timestamptz,
  created_at  timestamptz not null default now(),
  constraint crew_messages_system_has_no_author
    check (kind <> 'system' or author_id is null)
);

create index crew_messages_crew_id_created_at_idx on public.crew_messages (crew_id, created_at);

-- ---------------------------------------------------------------------------
-- After the event
-- ---------------------------------------------------------------------------

-- Invisible until mutual (Q6). Mutuality and the "showed up" badge are derived.
create table public.confirmations (
  crew_id      uuid not null references public.crews (id) on delete restrict,
  from_person  uuid not null references public.people (id) on delete cascade,
  to_person    uuid not null references public.people (id) on delete cascade,
  kind         public.confirmation_kind not null,
  created_at   timestamptz not null default now(),
  primary key (crew_id, from_person, to_person, kind),
  constraint confirmations_not_self check (from_person <> to_person)
);

create table public.connections (
  id              uuid primary key default gen_random_uuid(),
  person_a        uuid not null references public.people (id) on delete cascade,
  person_b        uuid not null references public.people (id) on delete cascade,
  source_crew_id  uuid references public.crews (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (person_a, person_b),
  constraint connections_ordered_pair check (person_a < person_b)
);

-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------

create table public.blocks (
  blocker_id  uuid not null references public.people (id) on delete cascade,
  blocked_id  uuid not null references public.people (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_id_idx on public.blocks (blocked_id);

-- Kept 12 months. Target FKs null out if the target is later deleted (e.g. a thread
-- at +30 days); target_kind records what was reported, and a reported message's
-- body is snapshotted so the report stays reviewable after the thread is gone.
create table public.reports (
  id                 uuid primary key default gen_random_uuid(),
  reporter_id        uuid references public.people (id) on delete set null,
  target_kind        public.report_target not null,
  target_person_id   uuid references public.people (id) on delete set null,
  target_crew_id     uuid references public.crews (id) on delete set null,
  target_message_id  uuid references public.crew_messages (id) on delete set null,
  reported_content_snapshot text,
  reason             public.report_reason not null,
  -- Severity derives from the reason, never asked of the reporter (H9).
  is_safety          boolean generated always as (reason in ('uncomfortable', 'under_19')) stored,
  status             public.report_status not null default 'open',
  decision_note      text,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint reports_at_most_one_target
    check (num_nonnulls(target_person_id, target_crew_id, target_message_id) <= 1),
  constraint reports_target_matches_kind check (
        (target_person_id  is null or target_kind = 'person')
    and (target_crew_id    is null or target_kind = 'crew')
    and (target_message_id is null or target_kind = 'message')
  )
);

-- Always taken from the message itself, never from the reporter's input.
-- security definer so the snapshot does not depend on the reporter's RLS view.
create function public.snapshot_reported_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.reported_content_snapshot := null;
  if new.target_message_id is not null then
    select m.body into new.reported_content_snapshot
    from public.crew_messages m
    where m.id = new.target_message_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.snapshot_reported_message() from public, anon, authenticated;

create trigger reports_snapshot_reported_message before insert on public.reports
  for each row execute function public.snapshot_reported_message();

create index reports_target_person_id_idx  on public.reports (target_person_id);
create index reports_target_crew_id_idx    on public.reports (target_crew_id);
create index reports_target_message_id_idx on public.reports (target_message_id);

-- ---------------------------------------------------------------------------
-- Test 0 plumbing
-- ---------------------------------------------------------------------------

-- Re-establishes a web session on any device (T5).
create table public.magic_links (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  person_id     uuid not null references public.people (id) on delete cascade,
  gathering_id  uuid references public.gatherings (id) on delete cascade,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- The only two messages Test 0 sends (T5, T8), once each per recipient per gathering.
create table public.outbound_messages (
  id             uuid primary key default gen_random_uuid(),
  gathering_id   uuid not null references public.gatherings (id) on delete cascade,
  person_id      uuid references public.people (id) on delete cascade,
  pin_friend_id  uuid references public.pin_friends (id) on delete cascade,
  kind           public.outbound_kind not null,
  channel        public.contact_kind not null,
  provider_id    text,
  sent_at        timestamptz not null default now(),
  constraint outbound_messages_one_recipient
    check (num_nonnulls(person_id, pin_friend_id) = 1)
);

create unique index outbound_messages_once_per_person
  on public.outbound_messages (gathering_id, person_id, kind) where person_id is not null;
create unique index outbound_messages_once_per_pin_friend
  on public.outbound_messages (gathering_id, pin_friend_id, kind) where pin_friend_id is not null;

create table public.survey_responses (
  id               uuid primary key default gen_random_uuid(),
  gathering_id     uuid not null references public.gatherings (id) on delete cascade,
  person_id        uuid references public.people (id) on delete set null,
  met              public.survey_met not null,
  would_have_gone  public.survey_would_have_gone not null,
  anything_off     text,
  created_at       timestamptz not null default now(),
  unique (gathering_id, person_id)
);

-- ---------------------------------------------------------------------------
-- RLS on every table, no policies (H11).
-- ---------------------------------------------------------------------------

alter table public.venues              enable row level security;
alter table public.meeting_spots       enable row level security;
alter table public.gatherings          enable row level security;
alter table public.gathering_spots     enable row level security;
alter table public.neighbourhoods      enable row level security;
alter table public.tags                enable row level security;
alter table public.people              enable row level security;
alter table public.person_tags         enable row level security;
alter table public.pins                enable row level security;
alter table public.pin_friends         enable row level security;
alter table public.contact_points      enable row level security;
alter table public.spot_votes          enable row level security;
alter table public.crews               enable row level security;
alter table public.crew_members        enable row level security;
alter table public.crew_proposals      enable row level security;
alter table public.crew_proposal_votes enable row level security;
alter table public.crew_join_requests  enable row level security;
alter table public.crew_messages       enable row level security;
alter table public.confirmations       enable row level security;
alter table public.connections         enable row level security;
alter table public.blocks              enable row level security;
alter table public.reports             enable row level security;
alter table public.magic_links         enable row level security;
alter table public.outbound_messages   enable row level security;
alter table public.survey_responses    enable row level security;
