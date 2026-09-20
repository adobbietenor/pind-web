-- Restore public_gathering. I broke it, and it took the map off every crowd page.
--
-- Adding the entry states, I rewrote this function by copying the definition from
-- m2_1_public_visibility — which was already superseded by m2_1_venue_maps. The
-- editor said "create or replace" and did exactly that: replaced a later version with
-- an earlier one, and four things went quietly.
--
--   1. `map_key` and `map_ready` vanished, so isReady() was false everywhere and
--      **every crowd page fell back to the schematic**, ticketed ones included. The
--      real Mapbox picture M2.1 exists for was gone from the whole site.
--   2. `timezone` became `city_timezone`, which nothing reads.
--   3. Spots lost their `s.active` filter and their `sort_order` ordering, so a
--      deactivated spot could be listed and the order was by meet time instead of the
--      venue's own.
--   4. Counts were rebuilt by hand with three fields, dropping women/men/other — so
--      the gender-mix chip (V3, Q3) had nothing to render.
--
-- None of it showed in a typecheck, a unit test or the policy harness: the function
-- returns jsonb, and every one of these is a key that simply stopped being there. It
-- showed the moment somebody loaded a page and the map was a drawing.
--
-- The lesson worth keeping: **a `create or replace` on a function somebody else has
-- already replaced is a silent revert.** Read the live definition, not the migration
-- that first created it.

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
    -- A slug this gathering used to have: point at the one it has now.
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
      -- The three that replaced is_free, and the chip.
      'entry', g.entry,
      'door_price_cents', g.door_price_cents,
      'entry_note', g.entry_note,
      'category', g.category,
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
