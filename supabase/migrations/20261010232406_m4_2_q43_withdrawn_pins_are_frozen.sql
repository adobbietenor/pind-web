-- M4.2 — Q43: a pin on a withdrawn gathering cannot be changed, only taken back (V13;
-- Alex, 10 Oct 2026).
--
-- What the review found: pins_update_own checks pinning_open (time) but not is_published,
-- so a person pinned to a withdrawn gathering could still change their party size —
-- moving the "pinned" count the gathering's other pinned people read. V13: what closes
-- at a withdrawal is pinning; what stays is every pin, which its owner can read and
-- remove. Read and remove — not edit. (The same held for a seed gathering for anyone who
-- is not a tester.)
--
-- The fix keeps the one promise the opt-in gate made (M3.2): **turning open_to_meeting
-- OFF is never refused** — taking yourself off a list is always possible. So it is a
-- trigger, which can compare before and after, not a policy, which cannot: on a gathering
-- that is not published (private.is_published — the pin-insert rule), a person may not
-- change party_total and may not turn open_to_meeting ON. Turning it off, and deleting
-- the pin, still work. The service key is not a person acting and is not checked.
-- Proved by P203; Q43 in the review suite turns green.

create function private.pins_frozen_when_unpublished() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and not private.is_published(new.gathering_id)
     and (new.party_total is distinct from old.party_total
          or (new.open_to_meeting and not old.open_to_meeting))
  then
    raise exception 'This gathering is no longer on Pin''d, so your pin cannot change — you can still remove it.'
      using errcode = 'check_violation', hint = 'q43_pin_frozen';
  end if;
  return new;
end;
$$;
revoke all on function private.pins_frozen_when_unpublished() from public;

create trigger pins_frozen_when_unpublished
  before update on public.pins
  for each row execute function private.pins_frozen_when_unpublished();
