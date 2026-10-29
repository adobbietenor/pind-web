-- M4.2 (Alex, 29 Oct 2026): a block DURING the night keeps the blocker's ticks too.
--
-- 20261029143155 kept a blocker's after-the-night ticks only when the group had already
-- finished. A block while it is live — the night itself, after people have met — took the
-- blocker out before it finished, so they kept nothing. Alex: "A block during the night keeps
-- the blocker's ticks with everyone else in the group, the same as a block after it. Same
-- principle: a block must never cost the person who uses it."
--
-- So a block in a live group records the keep as well; when the group finishes, the blocker
-- has "Who did you meet?" and the morning-after question with everyone but the person they
-- blocked. A block before the night (forming, spot set) keeps nothing — nobody has met yet.
-- Otherwise as 20261029143155.
create or replace function private.blocks_blocker_leaves_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_people(array[new.blocker_id, new.blocked_id]);
  insert into private.after_keeps (crew_id, person_id)
  select mine.crew_id, new.blocker_id
  from public.crew_members mine
  join public.crew_members theirs on theirs.crew_id = mine.crew_id
  join public.crews c on c.id = mine.crew_id
  where mine.person_id = new.blocker_id and mine.left_at is null
    and theirs.person_id = new.blocked_id and theirs.left_at is null
    and c.state in ('live', 'done')
  on conflict do nothing;
  update public.crew_members mine set left_at = now()
  from public.crew_members theirs, public.crews c
  where mine.person_id = new.blocker_id and mine.left_at is null
    and theirs.crew_id = mine.crew_id and theirs.person_id = new.blocked_id and theirs.left_at is null
    and c.id = mine.crew_id and c.state <> 'dissolved';
  -- Invites between the two lapse, whichever way they ran.
  update public.crew_invites set status = 'withdrawn', decided_at = now()
  where status = 'sent'
    and ((from_person = new.blocker_id and to_person = new.blocked_id)
      or (from_person = new.blocked_id and to_person = new.blocker_id));
  -- So do 1-on-1 proposals, at every gathering.
  perform private.close_solo_proposals(null, new.blocker_id, new.blocked_id);
  return new;
end;
$$;
