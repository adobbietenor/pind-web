-- Phase 2 M2.1 — what the public web layer needs in the database
-- (docs/visibility.md V18; spec.md §2 W1–W4; decisions.md Part 5, "pind.social
-- before production"). Three additions, no behaviour of their own: the seed marker,
-- the public slug and its history, and coordinates for meeting spots.
--
-- The rules that use these columns live in the next migration
-- (m2_1_public_visibility), so this file reads as plain schema.

-- ---------------------------------------------------------------------------
-- 1 · The seed marker — V18
--
-- Until pind-prod exists (M4.3), pind.social serves pind-staging, which holds the
-- seeded venues, gatherings and people the admin was built against. Seed rows must
-- never reach a public page, and "never" is a rule in the database, not a habit in
-- application code (H11), and not a text match on "[TEST] ".
--
-- false by default, so everything the importer, the admin and real people create is
-- real. No visitor can write it: the insert and update grants on people, pins and
-- every other visitor-writable table name their columns one by one, and this is not
-- among them. Only the service key sets it.
-- ---------------------------------------------------------------------------

alter table public.venues     add column is_seed boolean not null default false;
alter table public.gatherings add column is_seed boolean not null default false;
alter table public.people     add column is_seed boolean not null default false;

comment on column public.venues.is_seed     is 'Seed/test row. Invisible to every visitor (V18). Service key only.';
comment on column public.gatherings.is_seed is 'Seed/test row. Invisible to every visitor (V18). Service key only.';
comment on column public.people.is_seed     is 'Seed/test row. Invisible to every visitor, and sees nobody (V18). Service key only.';

-- The public read paths filter on exactly this shape, so it is worth an index.
create index gatherings_public_idx on public.gatherings (starts_at)
  where published_at is not null and withdrawn_at is null and not is_seed;

-- A gathering at a seed venue is a seed gathering, whether or not whoever inserted
-- it remembered. Set on the row, so the read policies stay a plain column test: a
-- policy that had to look the venue up would run that lookup under the *caller's*
-- RLS, where the seed venue is already hidden, and the test would invert.
create function private.seed_follows_venue() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.venue_id is not null
     and exists (select 1 from public.venues v where v.id = new.venue_id and v.is_seed) then
    new.is_seed := true;
  end if;
  return new;
end;
$$;

revoke execute on function private.seed_follows_venue() from public;

create trigger gatherings_seed_follows_venue
  before insert or update of venue_id, is_seed on public.gatherings
  for each row execute function private.seed_follows_venue();

-- Flagging a venue after the fact flags everything already at it.
create function private.seed_spreads_from_venue() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_seed and not old.is_seed then
    update public.gatherings set is_seed = true where venue_id = new.id and not is_seed;
  end if;
  return new;
end;
$$;

revoke execute on function private.seed_spreads_from_venue() from public;

create trigger venues_seed_spreads
  after update of is_seed on public.venues
  for each row execute function private.seed_spreads_from_venue();

-- ---------------------------------------------------------------------------
-- 2 · The public slug, and every slug it has ever had
--
-- Every public URL is /g/<slug> — the crowd page, the share card, the OG image and
-- the .ics file. A slug is minted when Alex publishes (admin_publish_gathering), and
-- nothing ever recomputes it: the importer renames nothing on a published gathering,
-- it raises a flag (M1.3, visibility §12d). If Alex changes a slug deliberately in
-- the admin, the old one is kept here and /g/<old> answers 301 forever, so a Reddit
-- post from six weeks ago still lands. A retired slug is never handed to another
-- gathering.
-- ---------------------------------------------------------------------------

alter table public.gatherings
  add column slug text unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80);

comment on column public.gatherings.slug is
  'The public URL segment: /g/<slug>. Minted at publish, changed only by hand in the admin; the old one lives on in gathering_slug_history as a 301.';

create table public.gathering_slug_history (
  slug         text primary key
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  gathering_id uuid not null references public.gatherings (id) on delete cascade,
  retired_at   timestamptz not null default now()
);

create index gathering_slug_history_gathering_idx on public.gathering_slug_history (gathering_id);

alter table public.gathering_slug_history enable row level security;

-- Supabase grants anon and authenticated everything on a new table; the read comes
-- back through a policy in the next migration, the writes never do.
revoke all on public.gathering_slug_history from anon, authenticated;
grant select on public.gathering_slug_history to anon, authenticated;

-- Changing a slug retires the old one. Clearing it is refused: a published URL that
-- starts answering 404 is worse than one that looks out of date.
--
-- A slug is spent the moment it is used, live or retired, and the check is inlined
-- rather than factored into a helper: trigger functions in `private` fire for the
-- service key, but a *call* from inside one needs usage on the schema, which
-- service_role does not have (the M1.3 spots_optional fix learned this the hard way).
create function private.slug_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.slug is distinct from old.slug then
    if old.slug is not null then
      if new.slug is null then
        raise exception 'Cannot remove a slug: /g/% is a published URL', old.slug using errcode = 'check_violation';
      end if;
      insert into public.gathering_slug_history (slug, gathering_id)
      values (old.slug, old.id)
      on conflict (slug) do nothing;
      -- Going back to a slug this gathering used before retires the history row
      -- instead of leaving a redirect that points at itself.
      delete from public.gathering_slug_history where slug = new.slug and gathering_id = new.id;
    end if;
    if new.slug is not null
       and (exists (select 1 from public.gatherings g where g.slug = new.slug and g.id <> new.id)
            or exists (select 1 from public.gathering_slug_history h
                       where h.slug = new.slug and h.gathering_id <> new.id)) then
      raise exception 'Slug % is already spent', new.slug using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.slug_history() from public;

create trigger gatherings_slug_history
  before update of slug on public.gatherings
  for each row execute function private.slug_history();

-- ---------------------------------------------------------------------------
-- 3 · Meeting spots on the map
--
-- The generated map (spec §2 W2) is drawn from the venue's coordinates, which M1.3
-- added, and the spots', which nothing has. Both optional: a spot with coordinates
-- is plotted, a spot without is listed by name underneath, and a venue with no
-- plotted spots still gets a usable page.
--
-- Walking minutes are calculated from the two coordinates. walk_minutes overrides
-- the calculation where it gets things wrong — a spot across a rail corridor, a
-- bridge that only crosses one way — and is set by hand in the admin.
--
-- Coordinates of public buildings and curated public spots are the only coordinates
-- this product holds (H4). No person ever has any.
-- ---------------------------------------------------------------------------

alter table public.meeting_spots
  add column latitude     double precision check (latitude between -90 and 90),
  add column longitude    double precision check (longitude between -180 and 180),
  add column walk_minutes smallint check (walk_minutes between 1 and 60),
  add constraint meeting_spots_lat_lng_together check ((latitude is null) = (longitude is null));

comment on column public.meeting_spots.walk_minutes is
  'Manual override for the walk from the venue. Null means the map calculates it from the coordinates.';
