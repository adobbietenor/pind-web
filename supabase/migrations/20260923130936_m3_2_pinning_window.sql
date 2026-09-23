-- M3.2 — the pinning window closes at the gathering's effective end (Alex, before M3.2).
--
-- Pinning had no upper time bound: a pin could be taken at a gathering that ended two
-- days ago (found in M2.2, recorded as P37b). It was a gap left from M1.1, not a
-- decision. Now:
--
--   * **pin in**: while the gathering is published AND before its effective end. Open
--     during it — somebody deciding at 9pm to join a thing that started at 8 is exactly
--     who this is for — and shut after.
--   * **edit** (party size, opt-in): the same window. Changing either after the end is
--     editing history.
--   * **remove**: always. Taking yourself off a list is never refused.
--
-- "Effective end" is `public.effective_end(g)`: `ends_at`, or `starts_at + 180 min`,
-- the one definition everything time-driven keys off (decisions Part 3).

create function private.pinning_open(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and now() < public.effective_end(g)
  );
$$;

revoke all on function private.pinning_open(uuid) from public;
grant execute on function private.pinning_open(uuid) to authenticated;

comment on function private.pinning_open(uuid) is
  'True until the gathering''s effective end. Gates pin insert and edit; never delete (M3.2).';

drop policy pins_insert_own on public.pins;
create policy pins_insert_own on public.pins
  for insert to authenticated
  with check (
    person_id = private.me()
    and private.is_published(gathering_id)
    and private.pinning_open(gathering_id)
  );

drop policy pins_update_own on public.pins;
create policy pins_update_own on public.pins
  for update to authenticated
  using (person_id = private.me() and private.pinning_open(gathering_id))
  with check (person_id = private.me() and private.pinning_open(gathering_id));

-- pins_delete_own is deliberately unchanged: own pin, any time.
