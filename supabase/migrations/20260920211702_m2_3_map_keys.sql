-- M2.3, after the on-device walk: every venue's current coordinate key, in one call.
--
-- **Why this exists.** The crowd page's map was being fetched by the first stranger to
-- open the page: the page fell back, and `waitUntil` made the picture afterwards for
-- whoever came next. That was built in M2.1 as a safety net and had quietly become the
-- mechanism — and M2.3 made it obvious by putting the zoom into the image's key, which
-- retired every existing render at once. Measured on staging: **29 of the 37 venues
-- behind a published gathering had no picture at their current key**, so the first view
-- of each of those pages showed a drawing, or nothing at all where the venue has no
-- spots to draw.
--
-- Two things needed the same fact — "what key should this venue's picture have right
-- now" — and neither could get it without a round trip per venue:
--   * the nightly pass that now renders maps ahead of any visitor;
--   * the admin's venue list, which was calling a venue "ready" if it had ANY
--     successful render, so a venue whose key had moved on read "ready" while its
--     crowd page served a 404. A status computed against the wrong fact reads as
--     correct while being wrong, which is the M2.2 venue-cap line all over again.
--
-- The zoom half of the key comes from the venue's spots and is computed in the Worker
-- (chooseZoom); this returns the coordinate half, which is the database's to know.
-- Service key only: it is operational detail, like the render records themselves (V12).

create function public.admin_venue_map_keys()
returns table (venue_id uuid, coord_key text)
language sql stable set search_path = '' as $$
  select v.id, public.venue_map_key(v.latitude, v.longitude)
  from public.venues v
  where not v.is_seed and v.latitude is not null and v.longitude is not null;
$$;

comment on function public.admin_venue_map_keys() is
  'Every real venue''s current map coordinate key, for the pre-render pass and the admin. The zoom half of the full key is the Worker''s (chooseZoom).';

revoke execute on function public.admin_venue_map_keys() from public, anon, authenticated;
grant execute on function public.admin_venue_map_keys() to service_role;
