-- M3.2 — "open to meeting" only for someone who has finished A27 (Alex, M3.2).
--
-- Opting in to meeting needs a permanent identity, a date of birth and gender, and a
-- photo (decisions Part 5, "Identity"; Q2). Nothing in the database said so: the A26
-- tick set `open_to_meeting` on an anonymous, photo-less pin at once. Alex's walk saw
-- "1 of 5" — the count was honest about the flag, and the flag was wrong. Once the
-- list exists, that anonymous first name with no face would have shown to people who
-- opted in.
--
-- The rule, for the Worker, the app and a raw token alike (RLS on the visitor's own
-- token; the service key is the admin's):
--
--   * a pin may be written with `open_to_meeting = true` only by a person who MAY MEET:
--     their auth user is not anonymous, they have a `people_private` row (date of
--     birth and gender), and they have a photo;
--   * turning it OFF is never refused — taking yourself off a list is always possible;
--   * `i_may_meet()` answers the question for the caller only, so a screen can say
--     "a few details first" instead of failing.
--
-- And the flags already set wrongly are cleared, so every count is honest from here.

create function private.may_meet(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.people p
    join auth.users u on u.id = p.auth_user_id
    join public.people_private pp on pp.person_id = p.id
    where p.id = p_person
      and not coalesce(u.is_anonymous, false)
      and p.photo_path is not null
  );
$$;
revoke all on function private.may_meet(uuid) from public;
grant execute on function private.may_meet(uuid) to authenticated;

create function public.i_may_meet() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.may_meet(p.id) from public.people p where p.auth_user_id = auth.uid()), false);
$$;
revoke all on function public.i_may_meet() from public, anon;
grant execute on function public.i_may_meet() to authenticated;

drop policy pins_insert_own on public.pins;
create policy pins_insert_own on public.pins
  for insert to authenticated
  with check (
    person_id = private.me()
    and private.has_attested(person_id)
    and private.is_published(gathering_id)
    and private.pinning_open(gathering_id)
    and (not open_to_meeting or private.may_meet(person_id))
  );

drop policy pins_update_own on public.pins;
create policy pins_update_own on public.pins
  for update to authenticated
  using (person_id = private.me() and private.pinning_open(gathering_id))
  with check (
    person_id = private.me()
    and private.pinning_open(gathering_id)
    and (not open_to_meeting or private.may_meet(person_id))
  );

-- The flags set before the gate existed, cleared. Only a real person's pin can be in
-- this set (test worlds are rebuilt per run), and none of them had finished A27.
update public.pins pi
set open_to_meeting = false
where pi.open_to_meeting
  and not private.may_meet(pi.person_id)
  and not exists (select 1 from public.people pe where pe.id = pi.person_id and pe.is_seed);
