-- A line for the reader (M2.3c, Alex: "'Toronto Tempo vs New York Liberty' tells a
-- reader nothing — is it basketball, is it a season opener, does any of it matter?").
--
-- **What the measurement changed about this feature, before a line of it was built.**
-- Ten real published rows, asked for a reader-facing line from the facts we hold — name,
-- venue, date, what it is filed under, what it costs:
--
--   from our facts alone   3 of 10 recognised; why_this_one null for 9 of 10
--   the same community
--   rows, with the
--   organiser's page       4 of 4 recognised, all four with a real "why"
--
-- Grounded, it produced "Casual pub chess tournament at a brewery, all skill levels /
-- Five quick 5+3 rounds unrated, followed by casual play till 11pm; no registration
-- needed" — which is exactly what was missing. Ungrounded, the unrecognised rows
-- restated their own titles: "A community knitting group at a public library".
--
-- **So this is not a prompt problem, it is a grounding problem, and the rule that
-- follows is: descriptions are only worth having where we are already fetching a
-- source** (Alex). The community half rides on the page the liveness check already
-- reads. The Events half is measured on real rows before it ships, because those
-- numbers do not transfer: an organiser's page is written by somebody who cares, and a
-- Ticketmaster row is a title and a venue.
--
-- **No line unless the source knew something.** `known: false` writes nothing at all —
-- a restatement of the title on two hundred rows is the same noise as a slogan, and a
-- blank is better than filler (Alex).
--
-- No visibility change: this is a column on a gathering, which is public when the
-- gathering is, through the same two doors as everything else.

alter table public.gatherings
  add column blurb        text check (char_length(blurb) <= 120),
  -- Kept apart rather than run together, because they are read in different places: the
  -- short one is all a card has room for, and both appear on the crowd page.
  add column blurb_why    text check (char_length(blurb_why) <= 160),
  add column blurb_source text check (blurb_source in ('page', 'knowledge', 'admin')),
  add column blurb_at     timestamptz,
  -- Either there is a line and we know where it came from, or there is neither.
  add constraint gatherings_blurb_sourced check ((blurb is null) = (blurb_source is null));

comment on column public.gatherings.blurb is
  'One short line saying what this is, for a reader deciding whether to go. Null where no source knew anything — a blank is better than a restatement of the title.';
comment on column public.gatherings.blurb_why is
  'What makes this one worth turning up to, where there is anything to say. Null is the common case and is not a gap.';
comment on column public.gatherings.blurb_source is
  'page = grounded in the organiser''s own page; knowledge = the model recognised it from our facts; admin = written or corrected by hand, and never overwritten by a machine.';

-- ---------------------------------------------------------------------------
-- Writing one, with the category's lifecycle (Alex: "same lifecycle as category — set
-- once, never overwritten by a machine, my edits final").
--
-- A machine may write only into a blank. An admin may always write, and what they write
-- is marked as theirs, so the next night's job leaves it alone. Clearing it by hand is
-- allowed and is also a decision: it sets the line back to blank and records who did it.
-- ---------------------------------------------------------------------------

create function public.admin_set_blurb(
  p_gathering uuid,
  p_blurb     text,
  p_why       text,
  p_source    text,
  p_actor     text
) returns boolean
language plpgsql set search_path = '' as $$
declare
  wrote boolean := false;
  v_name text;
begin
  if p_source not in ('page', 'knowledge', 'admin') then
    raise exception 'Unknown blurb source: %', p_source;
  end if;

  if p_source = 'admin' then
    update public.gatherings g set
      blurb = nullif(btrim(coalesce(p_blurb, '')), ''),
      blurb_why = nullif(btrim(coalesce(p_why, '')), ''),
      -- A hand-cleared line leaves no source behind, which is what lets a later run
      -- write one again. An emptied line that stayed marked 'admin' would be a blank
      -- nothing could ever fill, and nobody would remember why.
      blurb_source = case when nullif(btrim(coalesce(p_blurb, '')), '') is null then null else 'admin' end,
      blurb_at = now()
    where g.id = p_gathering
    returning g.name into v_name;
    if v_name is null then raise exception 'No such gathering'; end if;
    insert into public.moderation_log (actor, action, gathering_id, note)
    values (p_actor, 'blurb_set', p_gathering,
            case when nullif(btrim(coalesce(p_blurb, '')), '') is null then format('%s — line cleared', v_name)
                 else format('%s — %s', v_name, left(btrim(p_blurb), 120)) end);
    return true;
  end if;

  -- A machine: only into a blank, and only when it actually had something to say.
  if nullif(btrim(coalesce(p_blurb, '')), '') is null then return false; end if;

  update public.gatherings g set
    blurb = left(btrim(p_blurb), 120),
    blurb_why = left(nullif(btrim(coalesce(p_why, '')), ''), 160),
    blurb_source = p_source,
    blurb_at = now()
  where g.id = p_gathering
    and g.blurb is null;
  wrote := found;
  return wrote;
end;
$$;

revoke execute on function public.admin_set_blurb(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_blurb(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The two doors carry it
--
-- Rebuilt from the definitions 20260920203410_m2_3_the_list left behind — the live ones,
-- confirmed by reading their keys back before this was written. A create-or-replace from
-- a remembered body is a silent revert (decisions Part 5).
--
-- The list gets the short line only: a card has room for one. The crowd page gets both,
-- and the link out — "Tickets" for a ticket page, "Learn more" for an organiser's — is
-- built from event_url and signup_url, which it already had.
-- ---------------------------------------------------------------------------

drop function public.public_gatherings(timestamptz, timestamptz);

create function public.public_gatherings(p_from timestamptz, p_to timestamptz)
returns table (
  slug             text,
  name             text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  entry            public.entry_kind,
  door_price_cents integer,
  entry_note       text,
  category         public.gathering_category,
  signup_required  boolean,
  blurb            text,
  source           public.gathering_source,
  venue_id         uuid,
  venue_name       text,
  city_name        text,
  city_timezone    text,
  pinned           integer,
  open_to_meeting  integer,
  crews_open       boolean
)
language sql stable set search_path = '' as $$
  select
    g.slug, g.name, g.starts_at, g.ends_at, g.entry, g.door_price_cents, g.entry_note,
    g.category, g.signup_required, g.blurb, g.source,
    v.id, v.name, c.name, c.timezone,
    coalesce(co.pinned, 0), coalesce(co.open_to_meeting, 0), coalesce(co.crews_open, false)
  from public.gatherings g
  join public.venues v on v.id = g.venue_id
  join public.cities c on c.slug = v.city
  left join lateral public.gathering_counts(array[g.id]) co on true
  where g.slug is not null
    and g.withdrawn_at is null
    and g.starts_at >= p_from
    and g.starts_at < p_to
  order by g.starts_at, g.name;
$$;

create or replace function public.public_gathering(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g    public.gatherings;
  live text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('status', 'gone');
  end if;

  select * into g from public.gatherings x
  where x.slug = p_slug and x.published_at is not null and not x.is_seed;

  if not found then
    select x.slug into live
    from public.gathering_slug_history h
    join public.gatherings x on x.id = h.gathering_id
    where h.slug = p_slug and x.published_at is not null and not x.is_seed and x.slug is not null;

    if live is null then return jsonb_build_object('status', 'gone'); end if;
    return jsonb_build_object('status', 'redirect', 'slug', live);
  end if;

  if g.withdrawn_at is not null then
    return jsonb_build_object('status', 'withdrawn');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'gathering', jsonb_build_object(
      'id', g.id,
      'slug', g.slug,
      'name', g.name,
      'starts_at', g.starts_at,
      'ends_at', g.ends_at,
      'effective_end', public.effective_end(g),
      'entry', g.entry,
      'door_price_cents', g.door_price_cents,
      'entry_note', g.entry_note,
      'category', g.category,
      'signup_url', g.signup_url,
      'signup_required', g.signup_required,
      'blurb', g.blurb,
      'blurb_why', g.blurb_why,
      'source', g.source,
      'event_url', g.event_url
    ),
    'venue', (
      select jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'address', v.address,
        'latitude', v.latitude,
        'longitude', v.longitude,
        'map_image_path', v.map_image_path,
        'map_key', public.venue_map_key(v.latitude, v.longitude),
        'map_ready', coalesce((
          select jsonb_agg(r.map_key)
          from public.venue_map_renders r
          where r.venue_id = v.id and r.status = 'ok'
        ), '[]'::jsonb),
        -- Every active spot this venue has, coordinates only, so the zoom is the
        -- venue's and not this gathering's. Not the poll: that is `spots` below.
        'map_spots', coalesce((
          select jsonb_agg(jsonb_build_object('latitude', s.latitude, 'longitude', s.longitude)
                           order by s.sort_order, s.created_at)
          from public.meeting_spots s
          where s.venue_id = v.id and s.active
            and s.latitude is not null and s.longitude is not null
        ), '[]'::jsonb),
        'city_name', c.name,
        'timezone', c.timezone
      )
      from public.venues v
      join public.cities c on c.slug = v.city
      where v.id = g.venue_id
    ),
    'spots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', s.name,
               'description', s.description,
               'latitude', s.latitude,
               'longitude', s.longitude,
               'walk_minutes', s.walk_minutes,
               'meet_at', gs.meet_at
             ) order by s.sort_order, s.created_at)
      from public.gathering_spots gs
      join public.meeting_spots s on s.id = gs.spot_id
      where gs.gathering_id = g.id and s.active
    ), '[]'::jsonb),
    'counts', (
      select to_jsonb(co) - 'gathering_id'
      from public.gathering_counts(array[g.id]) co
    )
  );
end;
$$;
