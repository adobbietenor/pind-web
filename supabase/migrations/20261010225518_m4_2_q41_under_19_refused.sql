-- M4.2 — Q41: the 19+ gate holds in the database (H8; Alex, 10 Oct 2026: "This is H8, the
-- legal gate, and it does not work. Do this one first.").
--
-- What the review found: a signed-in person could save a birth year that made them 12 into
-- their own people_private row, and the insert trigger then recorded a 19+ attestation
-- (age_attestations, source 'a2') from it. The only check was 1900–2100. The app's own
-- date-of-birth check (ageOn) is the only thing that stood in the way, and a direct API
-- call skips the app.
--
-- Two rules, for every insert from every client — the deployed app included, so nothing
-- waits on a deploy:
--
--   1. **A birth year that is certainly under 19 is refused.** The row holds a year, not
--      a date, so this is the strongest rule the year allows: anyone born after
--      (this year − 19) is under 19 on every day of this year. Born in exactly
--      (this year − 19) is 18 or 19 depending on the day — the app's full-date check
--      (ageOn, at A2/A27) is what decides that boundary. "This year" is Toronto's.
--   2. **The attestation time is the server's.** age_attested_at was insertable, so a
--      client could backdate it. The value sent is ignored and replaced by now(). (The
--      app sends one today; it is overwritten, not refused, so A27 keeps working until
--      the app stops sending it.)
--
-- A refused row records no attestation: people_private_attests is an AFTER INSERT
-- trigger, so it never runs. The same rule covers updates of birth_year (only the service
-- key can make one — the merge — and it must obey H8 too). Proved by P194–P195; Q41 in
-- the review suite turns green.

create function private.people_private_19_plus() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_this_year integer := extract(year from (now() at time zone 'America/Toronto'))::integer;
begin
  if new.birth_year is not null and new.birth_year > v_this_year - 19 then
    raise exception 'Pin''d is for people aged 19 and over.'
      using errcode = 'check_violation', hint = 'h8_under_19';
  end if;
  if tg_op = 'INSERT' then
    new.age_attested_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.people_private_19_plus() from public;

create trigger people_private_19_plus
  before insert or update of birth_year on public.people_private
  for each row execute function private.people_private_19_plus();
