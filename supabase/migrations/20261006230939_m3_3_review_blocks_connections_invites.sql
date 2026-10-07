-- M3.3 — the independent review's block and connection leaks, fixed (Alex, 6 Oct 2026;
-- docs/visibility.md §12i/§12j; tests/policies/review-v20-v23.test.ts).
--
-- L2 (R88, R88h) — first, because a block that leaks where you're going is worse than no
-- block: the person using it believes it worked. "Connected" now means connected AND no
-- block either way AND neither hidden, everywhere it is asked — the invite picker, the
-- invite itself, the handle (V17), A20. A block or a hide ends the connection for every
-- purpose, not only in the list.
--
-- "Already going" (Alex): the picker and the invite count only a pin that is open to
-- meeting. A pin that is not open never opted in to being seen as wanting to meet, so it
-- must not tell anyone that its owner is going somewhere.
--
-- L1 (R86) — accepting an invite re-checks what sending it checked: the inviter and the
-- invitee can still see each other (no block either way, neither hidden), the invitee is
-- still in the group's room, and nobody already in the group has a block with them. An
-- invite across a block also disappears from the invitee's table read. The refusal is the
-- same words as a closed group, so it never tells anyone a block exists (R59).
--
-- L7 (R87) — blocking someone you share a group with: **the blocker leaves** (Alex,
-- against the recommendation that the blocked person be removed). Ejecting would give
-- every member a unilateral power to remove any other — block, gone, unblock — and nobody
-- consented to a group where that is possible. "You leave" cannot be weaponised, and it
-- costs the person who made the choice. **The cost, accepted by Alex: someone harassed
-- inside a group gives up the group.** The harassment case is answered by block + report
-- + an upheld moderation hide, which removes that person from rooms (L3/L4).
--
-- Re-invites (review §5) — a group invites a person once. After a decline, while the group
-- is still forming, "invite someone else" can no longer ping the same person again.

-- ---------------------------------------------------------------------------
-- L2 — connected means connected, unblocked and unhidden
-- ---------------------------------------------------------------------------

create or replace function private.are_connected(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections c
    where ((c.person_a = private.me() and c.person_b = p_target)
        or (c.person_b = private.me() and c.person_a = p_target))
      and not private.blocked_between(private.me(), p_target)
      and not exists (
        select 1 from public.people p
        where p.id in (private.me(), p_target) and p.hidden_at is not null
      )
  );
$$;

create or replace function public.invite_options(p_to uuid)
returns table (gathering_id uuid, name text, slug text, starts_at timestamptz, already text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.slug, g.starts_at,
    case
      when exists (select 1 from public.pins p where p.person_id = p_to and p.gathering_id = g.id and p.open_to_meeting) then 'going'
      when exists (select 1 from public.connection_invites i where i.gathering_id = g.id
                   and least(i.from_person, i.to_person) = least(private.me(), p_to)
                   and greatest(i.from_person, i.to_person) = greatest(private.me(), p_to)) then 'invited'
    end
  from public.pins mine join public.gatherings g on g.id = mine.gathering_id
  where mine.person_id = private.me() and private.are_connected(p_to)
    and g.published_at is not null and g.withdrawn_at is null and g.starts_at > now()
    and (not g.is_seed or private.person_is_tester(p_to))
  order by g.starts_at;
$$;

create or replace function public.invite_connection(p_to uuid, p_gathering uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  g public.gatherings;
begin
  if v_me is null or not private.are_connected(p_to) then
    raise exception 'refused: not connected' using errcode = '42501';
  end if;
  -- Five a day held under concurrent calls (R89): one inviter's invites are counted one at
  -- a time.
  perform pg_advisory_xact_lock(hashtext('connection_invites:' || v_me::text));
  select * into g from public.gatherings where id = p_gathering;
  if not found or g.published_at is null or g.withdrawn_at is not null or g.starts_at <= now()
     or (g.is_seed and not (private.person_is_tester(v_me) and private.person_is_tester(p_to))) then
    raise exception 'refused: not an upcoming gathering' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pins p where p.person_id = v_me and p.gathering_id = p_gathering) then
    raise exception 'refused: pin in first' using errcode = '42501';
  end if;
  if exists (select 1 from public.pins p where p.person_id = p_to and p.gathering_id = p_gathering and p.open_to_meeting) then
    raise exception 'refused: already going' using errcode = '42501';
  end if;
  if (select count(*) from public.connection_invites i where i.from_person = v_me and i.created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate: five invites a day' using errcode = '42501';
  end if;
  insert into public.connection_invites (from_person, to_person, gathering_id) values (v_me, p_to, p_gathering);
end;
$$;

-- ---------------------------------------------------------------------------
-- L1 — an invite is re-checked when it is accepted, and hidden across a block
-- ---------------------------------------------------------------------------

drop policy crew_invites_read_invitee on public.crew_invites;
create policy crew_invites_read_invitee on public.crew_invites
  for select to authenticated using (
    to_person = private.me()
    and not private.blocked_between(private.me(), from_person)
  );

create or replace function public.respond_to_invite(p_invite uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.crew_invites;
  v_crew public.crews;
  v_starts timestamptz;
begin
  select * into v_inv from public.crew_invites where id = p_invite and to_person = private.me() and status = 'sent';
  if v_inv.id is null then
    raise exception 'refused: no such invite' using errcode = '42501';
  end if;
  if not p_accept then
    update public.crew_invites set status = 'declined', decided_at = now() where id = p_invite;
    return;
  end if;
  select * into v_crew from public.crews where id = v_inv.crew_id;
  select starts_at into v_starts from public.gatherings where id = v_inv.gathering_id;
  if v_crew.state = 'dissolved' or now() >= v_starts
     -- What sending checked, checked again now (R86): no block between the invitee and the
     -- inviter or anyone already in the group, neither the invitee nor the inviter hidden,
     -- and the invitee still in the group's room. Same words as a closed group (R59).
     or private.blocked_between(v_inv.to_person, v_inv.from_person)
     or exists (
       select 1 from public.crew_members m
       where m.crew_id = v_inv.crew_id and m.left_at is null
         and private.blocked_between(v_inv.to_person, m.person_id)
     )
     or exists (select 1 from public.people p where p.id in (v_inv.to_person, v_inv.from_person) and p.hidden_at is not null)
     or not exists (
       select 1 from public.room_members rm
       where rm.room_id = v_crew.room_id and rm.person_id = v_inv.to_person and rm.left_at is null
     ) then
    update public.crew_invites set status = 'expired', decided_at = now() where id = p_invite;
    raise exception 'refused: that group is no longer open' using errcode = '42501';
  end if;
  insert into public.crew_members (crew_id, gathering_id, person_id) values (v_inv.crew_id, v_inv.gathering_id, v_inv.to_person);
  update public.crew_invites set status = 'accepted', decided_at = now() where id = p_invite;
  -- Any other open invites to me at this gathering lapse: one group per person.
  update public.crew_invites set status = 'withdrawn', decided_at = now()
  where to_person = v_inv.to_person and gathering_id = v_inv.gathering_id and status = 'sent';
  -- At 3, a group that meets at the gathering has its plan at once: "at the start".
  if private.active_members(v_inv.crew_id) >= 3 and v_crew.state = 'forming'
     and public.convening_of(v_inv.gathering_id) = 'at_the_gathering' then
    update public.crews set state = 'spot_set', meet_at = v_starts where id = v_inv.crew_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- L7 — blocking someone in your group: you leave
-- ---------------------------------------------------------------------------

create function private.blocks_blocker_leaves_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.crew_members mine set left_at = now()
  from public.crew_members theirs, public.crews c
  where mine.person_id = new.blocker_id and mine.left_at is null
    and theirs.crew_id = mine.crew_id and theirs.person_id = new.blocked_id and theirs.left_at is null
    and c.id = mine.crew_id and c.state in ('forming', 'spot_set', 'live');
  -- Invites between the two lapse, whichever way they ran.
  update public.crew_invites set status = 'withdrawn', decided_at = now()
  where status = 'sent'
    and ((from_person = new.blocker_id and to_person = new.blocked_id)
      or (from_person = new.blocked_id and to_person = new.blocker_id));
  return new;
end;
$$;
revoke all on function private.blocks_blocker_leaves_group() from public;

create trigger blocks_blocker_leaves_group after insert on public.blocks
  for each row execute function private.blocks_blocker_leaves_group();

-- ---------------------------------------------------------------------------
-- Re-invites — a group invites a person once
-- ---------------------------------------------------------------------------

create or replace function public.invite_more(p_crew uuid, p_invitees uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_crew public.crews;
  v_person uuid;
begin
  select * into v_crew from public.crews where id = p_crew;
  if v_crew.id is null or not private.in_group(p_crew) then
    raise exception 'refused: not your group' using errcode = '42501';
  end if;
  if v_crew.state <> 'forming' or private.active_members(p_crew) >= 3 then
    raise exception 'refused: this group is already on' using errcode = '42501';
  end if;
  if now() >= public.group_closes_at(p_crew) then
    raise exception 'refused: this group has closed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_invitees, 1), 0) not between 1 and 3 then
    raise exception 'refused: invite 1 to 3 people' using errcode = '22023';
  end if;
  foreach v_person in array p_invitees loop
    if v_crew.room_id is null or not private.can_invite(v_crew.room_id, v_person) then
      raise exception 'refused: you can invite only people you have talked with here' using errcode = '42501';
    end if;
  end loop;
  -- Once per person per group, whatever became of the first invite. Skipped quietly, so
  -- the inviter learns nothing about an answer they were never told (R50).
  insert into public.crew_invites (crew_id, gathering_id, from_person, to_person)
  select p_crew, v_crew.gathering_id, private.me(), x from unnest(p_invitees) x
  where not exists (select 1 from public.crew_invites i where i.crew_id = p_crew and i.to_person = x)
  on conflict do nothing;
end;
$$;
