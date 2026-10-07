-- M3.3 — a gathering may override its city's room size.
--
-- The acceptance list proves placement with a room of 3 ("the fourth person lands in a
-- second room"). Lowering Toronto's room_size would change every room on staging while
-- people walk it, and a harness-only city would be picked up by the nightly import and
-- the publisher. A per-gathering override is the narrow version: null means the city's
-- setting, and only the service key writes gatherings (the admin), so nobody can size
-- their own room. It also lets Alex give an unusual gathering a different size.

alter table public.gatherings add column room_size smallint check (room_size between 2 and 200);
comment on column public.gatherings.room_size is
  'Overrides the city''s room_size for this gathering (M3.3). Null: the city''s.';

create or replace function private.room_size(p_gathering uuid) returns smallint
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select g.room_size from public.gatherings g where g.id = p_gathering),
    (select c.room_size from public.gatherings g
       join public.venues v on v.id = g.venue_id
       join public.cities c on c.slug = v.city
      where g.id = p_gathering),
    30::smallint
  );
$$;
