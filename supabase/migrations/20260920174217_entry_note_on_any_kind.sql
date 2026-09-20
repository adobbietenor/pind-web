-- A note belongs on any entry kind, not only on a door (found while entering the
-- community list, 20 September 2026).
--
-- The original check tied door_price_cents *and* entry_note to entry = 'door', on the
-- reasoning that a price on a free gathering is meaningless. The price half is right.
-- The note half was not: Frontrunners is a free drop-in with an optional $30/yr
-- membership, which is exactly what a reader wants to know and is not a price. A
-- ticketed gathering can want one too — "sold out at the door, tickets online".
--
-- The price stays door-only, because the door is the only thing this product knows
-- the price of.

alter table public.gatherings drop constraint gatherings_door_price_needs_a_door;

alter table public.gatherings
  add constraint gatherings_door_price_needs_a_door
    check (entry = 'door' or door_price_cents is null);

comment on column public.gatherings.entry_note is
  'A short qualifier on the cost, for any entry kind: "cash only", "optional $30/yr membership", "half price if you buy alcohol".';
