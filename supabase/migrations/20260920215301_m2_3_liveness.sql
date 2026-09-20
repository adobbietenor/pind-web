-- M2.3b — is that run club still a run club? (Alex, after the M2.3 walk.)
--
-- **The problem, measured.** 28 hand-entered series have produced **188 published,
-- dated occurrences running to 31 December**, and nothing re-checks any of them. A
-- defunct run club on the site is worse than a thin list: somebody turns up to a park
-- at 9am because our page said so. The risk is live now and needs none of M4.4's
-- discovery half to be worth fixing.
--
-- **Why the obvious cheap check does not work.** All 28 pages were fetched on
-- 2026-09-20: **27 answered 200 and none was gone**, so "is the page alive" carries
-- almost no information. Two things kill the deterministic version outright:
--   * **4 of the 27 name no future date at all** — Running Rats and all three
--     Frontrunners runs say "every Tuesday, 6:30pm" and never list dates. A
--     "does it name a date" rule would flag four live series on day one, which is a
--     guard firing in normal weather.
--   * **A page is not a series.** Seven series share one 582 KB Snakes & Lattes page,
--     five share tbn.ca, three share the same 519 page. Matching keywords or dates on a
--     shared page says nothing about one game night.
-- So the check reads the page and asks one narrow question per series. That is
-- deliberately the first slice of M4.4's extraction, measured early against 28 pages
-- whose answers we already know (docs/m4.4-brief.md).
--
-- **The lifecycle, confirmed by Alex before this was built.** Per series:
--   unverified   → nothing has been read yet. Where all 28 start.
--   confirmed    → the last read found the series on its page. Records when, and how far
--                  ahead the page itself named dates (confirmed_through).
--   doubtful     → the page is gone (404/410 — unambiguous, on the first read), or two
--                  consecutive good reads did not find the series on it.
--   unverifiable → the page could not be read at all. Counted separately and **never**
--                  promoted to doubtful, because no evidence is not evidence. Three
--                  consecutive failures becomes a line saying we cannot check this one,
--                  which is a different sentence from "this one has stopped".
--   settled      → Alex looked and said leave it. Stamps confirmed and records who and
--                  when, because **a flag that cannot be cleared becomes a flag nobody
--                  reads** (Alex).
-- Only a read moves it, and **nothing is ever withdrawn or unpublished automatically.**
-- Withdrawing keeps the pins and can be undone; unpublishing cannot be undone by any
-- automatic run, because the slug is already minted and `slug is null` is the
-- re-publish guard (M2.2) — so the worse of the two is also the irreversible one.
--
-- No visibility change: this table is the service key's alone, like every other
-- operational record (V12). Nothing here is readable by a visitor, and nothing here
-- decides what a visitor sees.

-- ---------------------------------------------------------------------------
-- 1 · The series, as provenance — NOT as recurrence
--
-- There is still no recurrence in the schema, and this is not it: the dated rows remain
-- independent gatherings, and a crew still meets on a night rather than on a series
-- (decisions Part 5). What this row holds is **where a gathering came from and whether
-- that source still says it happens** — which is the shape M4.4's source list needs
-- anyway, arriving early and with real rows in it.
-- ---------------------------------------------------------------------------

create table public.community_series (
  id                 uuid primary key default gen_random_uuid(),
  -- The series as it is named on the site. Unique, because that is how the 28 already
  -- group, and because two series with one name is a data problem, not a state to hold.
  label              text not null unique check (char_length(label) between 1 and 200),
  url                text not null check (url ~ '^https?://'),
  -- Verification, all of it written by a read and nothing else.
  last_checked_at    timestamptz,
  last_confirmed_at  timestamptz,
  -- The furthest date the page itself named. Null means the page says it happens but
  -- never says when — which is most run clubs, and is not a fault.
  confirmed_through  date,
  -- What the page says about how often, in its own words. Never parsed into a rule:
  -- the rule is whatever dated rows exist.
  cadence_seen       text check (char_length(cadence_seen) <= 120),
  -- Read fine, series not on it. Two of these is doubt.
  strikes            smallint not null default 0 check (strikes >= 0),
  -- Could not read the page at all. Never becomes doubt.
  unreadable_strikes smallint not null default 0 check (unreadable_strikes >= 0),
  last_status        text check (char_length(last_status) <= 200),
  last_note          text check (char_length(last_note) <= 300),
  settled_at         timestamptz,
  settled_by         text,
  settled_note       text check (char_length(settled_note) <= 300),
  created_at         timestamptz not null default now(),
  constraint community_series_settled_together check ((settled_at is null) = (settled_by is null))
);

comment on table public.community_series is
  'Where a hand-entered or community-sourced gathering came from, and whether that page still says it happens. Provenance and verification only — not a recurrence rule, and never read by a visitor.';

create index community_series_checked_idx on public.community_series (last_checked_at nulls first);

alter table public.community_series enable row level security;
revoke all on public.community_series from anon, authenticated;

alter table public.gatherings
  add column series_id uuid references public.community_series (id) on delete set null;

comment on column public.gatherings.series_id is
  'The source this occurrence came from, where it has one. Provenance, never recurrence: the row is an ordinary gathering and stands alone.';

create index gatherings_series_idx on public.gatherings (series_id) where series_id is not null;

-- ---------------------------------------------------------------------------
-- 2 · How far ahead a series may be generated
-- ---------------------------------------------------------------------------

alter table public.cities
  add column community_weeks smallint not null default 8 check (community_weeks between 1 and 26);

comment on column public.cities.community_weeks is
  'How far ahead the series generator may create dated drafts. Eight weeks by default, matching the Ticketmaster import''s own horizon, so the product has one idea of how far ahead it looks. A cap without a top-up is a decay mechanism, so the admin also counts series running out of dates.';

-- ---------------------------------------------------------------------------
-- 3 · Recording a read, and settling a doubt
--
-- The function is a recorder: it is handed the outcome of ONE read and moves the
-- counters. It deliberately does not decide what the counters mean — that reading is in
-- src/community/liveness.ts, in one place, so the job and the admin can never disagree
-- about whether a series is doubtful.
-- ---------------------------------------------------------------------------

create function public.admin_record_series_check(
  p_series            uuid,
  -- 'confirmed' — the page says it happens; 'absent' — read fine, series not on it;
  -- 'gone' — the page itself is 404/410; 'unreadable' — could not be read at all.
  p_outcome           text,
  p_confirmed_through date default null,
  p_cadence           text default null,
  p_status            text default null,
  p_note              text default null
) returns void
language plpgsql set search_path = '' as $$
begin
  if p_outcome not in ('confirmed', 'absent', 'gone', 'unreadable') then
    raise exception 'Unknown check outcome: %', p_outcome;
  end if;

  update public.community_series s set
    last_checked_at = now(),
    last_status = left(p_status, 200),
    last_note = left(p_note, 300),
    -- A confirmation clears everything, including a settling: the series is simply fine
    -- again, and the next doubt should be raised fresh rather than inherit an old one.
    last_confirmed_at  = case when p_outcome = 'confirmed' then now() else s.last_confirmed_at end,
    confirmed_through  = case when p_outcome = 'confirmed' then p_confirmed_through else s.confirmed_through end,
    cadence_seen       = case when p_outcome = 'confirmed' then left(p_cadence, 120) else s.cadence_seen end,
    strikes = case
      when p_outcome = 'confirmed' then 0
      when p_outcome = 'gone' then 2          -- unambiguous: doubt on the first read
      when p_outcome = 'absent' then s.strikes + 1
      else s.strikes                           -- unreadable changes nothing here
    end,
    unreadable_strikes = case
      when p_outcome = 'unreadable' then s.unreadable_strikes + 1
      else 0
    end,
    settled_at = case when p_outcome = 'confirmed' then null else s.settled_at end,
    settled_by = case when p_outcome = 'confirmed' then null else s.settled_by end,
    settled_note = case when p_outcome = 'confirmed' then null else s.settled_note end
  where s.id = p_series;

  if not found then raise exception 'No such series'; end if;
end;
$$;

revoke execute on function public.admin_record_series_check(uuid, text, date, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_record_series_check(uuid, text, date, text, text, text) to service_role;

-- "I looked, leave it." Stamps the series confirmed by Alex's own hand and records that
-- he looked, so the doubt clears and the panel stops repeating itself.
create function public.admin_settle_series(p_series uuid, p_actor text, p_note text default null)
returns void
language plpgsql set search_path = '' as $$
declare
  v_label text;
begin
  update public.community_series s set
    settled_at = now(),
    settled_by = p_actor,
    settled_note = left(p_note, 300),
    last_confirmed_at = now(),
    strikes = 0,
    unreadable_strikes = 0
  where s.id = p_series
  returning s.label into v_label;

  if v_label is null then raise exception 'No such series'; end if;

  insert into public.moderation_log (actor, action, note)
  values (p_actor, 'series_settle', format('%s — checked by hand%s', v_label, case when p_note is null then '' else ': ' || p_note end));
end;
$$;

revoke execute on function public.admin_settle_series(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_settle_series(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4 · The generator learns the horizon (the live definition, with one guard added)
--
-- Rebuilt from the definition 20260920183523_series_cadence left behind — which was
-- confirmed live first, by calling it and reading back its own year-guard message,
-- rather than trusted from the file. A create-or-replace built from a remembered body
-- is a silent revert (decisions Part 5).
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_series(
  p_template jsonb,
  p_until    date,
  p_cadence  public.series_cadence,
  p_actor    text
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  first_start timestamptz;
  tz          text;
  ids         uuid[] := '{}';
  new_id      uuid;
  at          timestamptz;
  local_first date;
  local_next  date;
  ends_gap    interval;
  n           integer := 0;
  clock       time;
  dow         integer;
  nth         integer;
  from_end    boolean;
  month_start date;
  weeks_ahead integer;
begin
  first_start := (p_template ->> 'starts_at')::timestamptz;
  if first_start is null then raise exception 'A series needs a first date'; end if;
  if p_until is null then raise exception 'A series needs a date to repeat until'; end if;

  select c.timezone into tz
  from public.venues v join public.cities c on c.slug = v.city
  where v.id = (p_template ->> 'venue_id')::uuid;
  tz := coalesce(tz, 'America/Toronto');

  local_first := (first_start at time zone tz)::date;
  clock       := (first_start at time zone tz)::time;

  -- **How far ahead a series may be generated** (Alex, after the M2.3 walk). It was a
  -- year from the first date, and the community pass used it: 188 dated rows out to
  -- 31 December from 28 series, none of which any organiser page confirms that far.
  -- Now a setting on the city, because it is a judgement that should move with evidence
  -- rather than with whoever is typing. Eight weeks by default — the same horizon the
  -- Ticketmaster import already looks over, so the product has one idea of "how far
  -- ahead we look" rather than two.
  --
  -- Measured from TODAY, not from the first date: what matters is how far into the
  -- future the site claims to know, and a series whose first date is months away should
  -- not inherit a year's licence because of it.
  select c.community_weeks into weeks_ahead
  from public.cities c
  where c.slug = coalesce((select v.city from public.venues v where v.id = (p_template ->> 'venue_id')::uuid), 'toronto');
  weeks_ahead := coalesce(weeks_ahead, 8);

  if p_until > ((now() at time zone tz)::date + weeks_ahead * 7) then
    raise exception 'That repeats past the % weeks this city generates ahead (to %). Enter a nearer end date, or raise the setting.',
      weeks_ahead, ((now() at time zone tz)::date + weeks_ahead * 7);
  end if;

  if p_until > local_first + 400 then
    raise exception 'That repeats for more than a year. Enter a nearer end date.';
  end if;

  ends_gap := case
    when p_template ? 'ends_at' and (p_template ->> 'ends_at') is not null
    then (p_template ->> 'ends_at')::timestamptz - first_start
  end;

  -- Monthly: the weekday, and which one of it. "Last" wins over "fourth" whenever
  -- there is no fifth, because that is what people mean.
  dow      := extract(dow from local_first)::integer;
  nth      := ((extract(day from local_first)::integer - 1) / 7) + 1;
  from_end := (local_first + 7) > (date_trunc('month', local_first) + interval '1 month' - interval '1 day')::date;

  local_next := local_first;
  while local_next <= p_until loop
    at := (local_next + clock) at time zone tz;
    insert into public.gatherings (
      name, starts_at, ends_at, venue_id, venue_name_raw, event_url,
      entry, door_price_cents, entry_note, category, featured, source
    ) values (
      p_template ->> 'name',
      at,
      case when ends_gap is not null then at + ends_gap end,
      (p_template ->> 'venue_id')::uuid,
      p_template ->> 'venue_name_raw',
      p_template ->> 'event_url',
      coalesce((p_template ->> 'entry')::public.entry_kind, 'ticketed'),
      (p_template ->> 'door_price_cents')::integer,
      p_template ->> 'entry_note',
      (p_template ->> 'category')::public.gathering_category,
      coalesce((p_template ->> 'featured')::boolean, false),
      'manual'
    )
    returning id into new_id;

    ids := ids || new_id;
    n := n + 1;

    -- The next date, in the venue's own calendar. Adding days locally and converting
    -- back is what keeps an 8am run club at 8am across the daylight-saving change.
    if p_cadence = 'weekly' then
      local_next := local_next + 7;
    elsif p_cadence = 'fortnightly' then
      local_next := local_next + 14;
    else
      month_start := (date_trunc('month', local_next) + interval '1 month')::date;
      if from_end then
        -- The last <dow> of the following month.
        local_next := (date_trunc('month', month_start) + interval '1 month' - interval '1 day')::date;
        local_next := local_next - ((extract(dow from local_next)::integer - dow + 7) % 7);
      else
        -- The nth <dow>: step to the first one, then add whole weeks.
        local_next := month_start + ((dow - extract(dow from month_start)::integer + 7) % 7);
        local_next := local_next + 7 * (nth - 1);
        -- A month with only four of that weekday takes the fourth.
        if extract(month from local_next) <> extract(month from month_start) then
          local_next := local_next - 7;
        end if;
      end if;
    end if;
  end loop;

  if n = 0 then raise exception 'That end date is before the first gathering'; end if;

  insert into public.moderation_log (actor, action, note)
  values (p_actor, 'series_create', format('%s — %s drafts, %s until %s', p_template ->> 'name', n, p_cadence, p_until));

  return jsonb_build_object('created', n, 'ids', to_jsonb(ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5 · The backfill: the 28 series that already exist
--
-- Deliberately explicit rather than clever. One series per distinct name among the
-- hand-entered gatherings that carry a link — every one of the 28 does, either an event
-- URL or a registration URL — and the occurrences point at it. min() picks the link
-- where occurrences disagree, which they do not today; the check reads the page and
-- would say so if it were wrong.
-- ---------------------------------------------------------------------------

insert into public.community_series (label, url)
select g.name, min(coalesce(g.event_url, g.signup_url))
from public.gatherings g
where g.source = 'manual'
  and not g.is_seed
  and coalesce(g.event_url, g.signup_url) is not null
  and coalesce(g.event_url, g.signup_url) ~ '^https?://'
  and g.starts_at > now() - interval '1 day'
group by g.name
on conflict (label) do nothing;

update public.gatherings g
set series_id = s.id
from public.community_series s
where g.series_id is null
  and g.source = 'manual'
  and not g.is_seed
  and g.name = s.label;
