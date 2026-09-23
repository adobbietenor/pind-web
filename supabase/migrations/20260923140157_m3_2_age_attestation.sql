-- M3.2 — the 19+ attestation, recorded, and required for a pin (Alex, M3.2; H8).
--
-- A26 asks one thing about age: "I'm 19 or older". Until now that tick had nowhere to
-- live for an anonymous person — `people_private` needs a gender and a birth year they
-- have not given — so a pin never required it, and a session token calling the API
-- directly could pin without it.
--
--   * **Its own record, `age_attestations`**: when the person said so, and how (the A26
--     tick, or A2's date of birth). Written once by the person; never changed, never
--     removed by them; readable only by them and the service key; gone with the person.
--   * **Not on the `people` row**, because anyone who can see you at a gathering can read
--     that whole row (V1), and an attestation is not for them.
--   * **A pin requires it**, in the database (P100/P101).
--   * **Under 19 at A27 removes them completely** (Alex): the pin, the person, the record
--     and the anonymous auth user — `remove_me_under_19()`, callable only by an
--     anonymous session, for itself (P103, P104). They have told us they are under 19;
--     keeping their pin in a count on a 19+ product would be knowingly keeping it.

create table public.age_attestations (
  person_id   uuid primary key references public.people (id) on delete cascade,
  attested_at timestamptz not null default now(),
  source      text not null check (source in ('a26', 'a2'))
);
alter table public.age_attestations enable row level security;

comment on table public.age_attestations is
  'When a person said they are 19 or older, and how (A26 tick or A2 date of birth). Owner-only; never on the people row (V1 can read that). Required for a pin (M3.2).';

revoke all on public.age_attestations from public, anon, authenticated;
grant select on public.age_attestations to authenticated;
grant insert (person_id, source) on public.age_attestations to authenticated;
-- No update, no delete: an attestation is not something a person revises.

create policy age_attestations_read_own on public.age_attestations
  for select to authenticated using (person_id = private.me());

create policy age_attestations_insert_own on public.age_attestations
  for insert to authenticated with check (person_id = private.me());

-- Everyone who finished A2 already attested there, with a date of birth.
insert into public.age_attestations (person_id, attested_at, source)
select person_id, age_attested_at, 'a2' from public.people_private
on conflict (person_id) do nothing;

-- And every later A2 records it too, so the app's A2 needs no change.
create function private.attest_from_a2() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.age_attestations (person_id, attested_at, source)
  values (new.person_id, new.age_attested_at, 'a2')
  on conflict (person_id) do nothing;
  return new;
end;
$$;
revoke execute on function private.attest_from_a2() from public;

create trigger people_private_attests after insert on public.people_private
  for each row execute function private.attest_from_a2();

create function private.has_attested(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.age_attestations a where a.person_id = p_person);
$$;
revoke all on function private.has_attested(uuid) from public;
grant execute on function private.has_attested(uuid) to authenticated;

drop policy pins_insert_own on public.pins;
create policy pins_insert_own on public.pins
  for insert to authenticated
  with check (
    person_id = private.me()
    and private.has_attested(person_id)
    and private.is_published(gathering_id)
    and private.pinning_open(gathering_id)
  );

-- Under 19 at A27: everything goes, not hidden. Order: the person row (which takes
-- the pins, the attestation, the private row and every other row keyed to it), then
-- the anonymous auth user — deleting the auth user alone would only null the link
-- (`people.auth_user_id ... on delete set null`) and leave the person behind.
-- Only an anonymous session may call it, and only for itself: a permanent account
-- has Delete account (A23), and nothing here takes an id.
create function public.remove_me_under_19() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Only an anonymous session can use this' using errcode = '42501';
  end if;
  delete from public.people where auth_user_id = v_user;
  delete from auth.users where id = v_user;
end;
$$;
revoke all on function public.remove_me_under_19() from public, anon;
grant execute on function public.remove_me_under_19() to authenticated;
