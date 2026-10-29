-- M4.2 (Alex, 29 Oct 2026): a block holds in every state, and costs the blocker nothing.
--
-- A BLOCK REMOVES THE BLOCKER FROM EVERY GROUP THEY SHARE with the person they blocked —
--   squads, 1-on-1 plans and older groups — in any state except one already dissolved,
--   silently. It used to hold only while a group was forming, set or live, so for the 24
--   hours after the night the two shared a finished squad's chat: "the window where it
--   matters most — that's when someone blocks after actually meeting a person" (Alex).
--
-- V23 CHANGES: LEAVING A FINISHED GROUP BY BLOCKING KEEPS YOUR TICKS WITH EVERYONE ELSE.
--   Out of the chat, but "Who did you meet?" still lists, and lets you tick, everyone in
--   that group except the person you blocked — and they still see you — for its 7 days.
--   Alex, for the record: "a block is the only safety tool the person being harmed operates
--   themselves, so it must cost them nothing. If blocking one person in a squad of five also
--   erases the connections you made with the other three, blocking has a price, and the
--   people most likely to need it are the ones most likely to decide it isn't worth paying."
--   A hide is unchanged: moderation removing someone for their own behaviour, so the loss is
--   theirs (20261029142920).
--
-- Kept in private.after_keeps, which no session reads; the chat (in_group) is untouched by
-- it. The blocker and the blocked never see or tick each other: every after-the-night read
-- already refuses across a block.

create table private.after_keeps (
  crew_id    uuid not null references public.crews (id) on delete cascade,
  person_id  uuid not null references public.people (id) on delete cascade,
  kept_at    timestamptz not null default now(),
  primary key (crew_id, person_id)
);
alter table private.after_keeps enable row level security;
revoke all on private.after_keeps from public, anon, authenticated;
comment on table private.after_keeps is
  'Who left a finished group by blocking someone in it, and so keeps its after-the-night ticks with the others (V23, M4.2). Not chat membership.';

-- In a group for the purposes of after the night: a member, or someone who left a finished
-- group by blocking. Only the after-the-night functions ask this.
create function private.in_after_group(p_person uuid, p_crew uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crew_members m where m.crew_id = p_crew and m.person_id = p_person and m.left_at is null)
      or exists (select 1 from private.after_keeps k where k.crew_id = p_crew and k.person_id = p_person);
$$;
revoke all on function private.in_after_group(uuid, uuid) from public;

-- The block: both people's locks first (20261029140204), then the blocker leaves every
-- shared group in any state but dissolved; leaving a finished one by blocking is kept.
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
    and c.state = 'done'
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

-- after_shared, after_tick, after_state and after_peer: as before, with "in the group" read
-- through in_after_group wherever it means after the night.
create or replace function private.after_shared(p_me uuid, p_to uuid, p_gathering uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id order by c.kind), '{}')
  from public.crews c
  where c.gathering_id = p_gathering
    and private.in_after_group(p_me, c.id) and private.in_after_group(p_to, c.id)
    and private.after_open(c.id);
$$;

create or replace function public.after_tick(p_crew uuid, p_to uuid, p_kind public.confirmation_kind, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_g uuid;
  v_shared uuid[];
begin
  select gathering_id into v_g from public.crews where id = p_crew;
  if v_me is null or v_me = p_to or v_g is null
     or not private.in_after_group(v_me, p_crew)
     or private.blocked_between(v_me, p_to) then
    raise exception 'refused: not in this group' using errcode = '42501';
  end if;
  if not private.after_open(p_crew) then
    raise exception 'refused: after closed' using errcode = '42501';
  end if;
  v_shared := private.after_shared(v_me, p_to, v_g);
  if cardinality(v_shared) = 0 then
    raise exception 'refused: not in this group' using errcode = '42501';
  end if;
  if p_on then
    if p_kind = 'keep_in_touch' and not exists (
      select 1 from unnest(v_shared) c
      where private.ticked(c, v_me, p_to, 'we_met') and private.ticked(c, p_to, v_me, 'we_met')
    ) then
      raise exception 'refused: we met first' using errcode = '42501';
    end if;
    insert into public.confirmations (crew_id, from_person, to_person, kind)
    select c, v_me, p_to, p_kind from unnest(v_shared) c
    on conflict do nothing;
    if p_kind = 'keep_in_touch' and exists (select 1 from unnest(v_shared) c where private.ticked(c, p_to, v_me, 'keep_in_touch')) then
      insert into public.connections (person_a, person_b, source_crew_id)
      values (least(v_me, p_to), greatest(v_me, p_to), v_shared[1])
      on conflict do nothing;
    end if;
  else
    -- Take a tick back only while it is unmatched. Taking back "we met" takes the
    -- unmatched "keep in touch" that hung on it too.
    if exists (
      select 1 from unnest(v_shared) c
      where private.ticked(c, p_to, v_me, p_kind) and private.ticked(c, v_me, p_to, p_kind)
    ) then
      raise exception 'refused: matched' using errcode = '42501';
    end if;
    delete from public.confirmations
    where crew_id = any (v_shared) and from_person = v_me and to_person = p_to
      and (kind = p_kind or (p_kind = 'we_met' and kind = 'keep_in_touch'));
  end if;
end;
$$;

create or replace function public.after_state(p_gathering uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_crews uuid[];
  v_ended boolean;
begin
  if v_me is null then return null; end if;
  select now() >= public.effective_end(g) into v_ended from public.gatherings g where g.id = p_gathering;
  select coalesce(array_agg(c.id order by c.kind), '{}') into v_crews
  from public.crews c
  where c.gathering_id = p_gathering and c.state = 'done' and c.hidden_at is null
    and private.in_after_group(v_me, c.id);
  return jsonb_build_object(
    'ended', coalesce(v_ended, false),
    'asked', coalesce(v_ended, false) and exists (
      select 1 from public.pins p where p.person_id = v_me and p.gathering_id = p_gathering and p.open_to_meeting),
    'answered', exists (select 1 from public.survey_responses s where s.person_id = v_me and s.gathering_id = p_gathering),
    'crew_id', v_crews[1],
    'open', exists (select 1 from unnest(v_crews) c where private.after_open(c)),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', x.id,
        'first_name', x.first_name,
        'photo_path', x.photo_path,
        'we_met', exists (select 1 from unnest(x.shared) c where private.ticked(c, v_me, x.id, 'we_met')),
        'we_met_matched', exists (select 1 from unnest(x.shared) c where private.ticked(c, v_me, x.id, 'we_met') and private.ticked(c, x.id, v_me, 'we_met')),
        'keep', exists (select 1 from unnest(x.shared) c where private.ticked(c, v_me, x.id, 'keep_in_touch')),
        'keep_matched', exists (select 1 from unnest(x.shared) c where private.ticked(c, v_me, x.id, 'keep_in_touch') and private.ticked(c, x.id, v_me, 'keep_in_touch'))
      ) order by x.joined_at)
      from (
        -- Each person once, however many plans you shared with them.
        select pe.id, pe.first_name,
               case when pe.photo_status <> 'rejected' then pe.photo_path end as photo_path,
               min(m.joined_at) as joined_at,
               array_agg(m.crew_id) as shared
        from public.crew_members m join public.people pe on pe.id = m.person_id
        where m.crew_id = any (v_crews) and m.person_id <> v_me
          and private.in_after_group(m.person_id, m.crew_id)
          and pe.hidden_at is null and not private.blocked_between(v_me, pe.id)
        group by pe.id, pe.first_name, pe.photo_status, pe.photo_path
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.after_peer(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select me.id <> p_target
       and not private.is_hidden(me.id)
       and not private.blocked_between(me.id, p_target)
       and exists (
         select 1 from public.people t
         where t.id = p_target and t.hidden_at is null and (not t.is_seed or private.i_am_tester())
       )
       and (
         private.are_connected(p_target)
         -- Together in a group that is still on: both members.
         or exists (
           select 1 from public.crew_members mine
           join public.crew_members theirs on theirs.crew_id = mine.crew_id
           join public.crews c on c.id = mine.crew_id
           where mine.person_id = me.id and mine.left_at is null
             and theirs.person_id = p_target and theirs.left_at is null
             and c.state in ('forming', 'spot_set', 'live')
         )
         -- Together in a finished group, for its 7 days: members, or kept by a block.
         -- (From my own membership rows: someone kept by a block still has theirs, left.)
         or exists (
           select 1 from public.crew_members mm
           where mm.person_id = me.id
             and private.after_open(mm.crew_id)
             and private.in_after_group(me.id, mm.crew_id) and private.in_after_group(p_target, mm.crew_id)
         )
       )
    from (select private.me() as id) me
    where me.id is not null
  ), false);
$$;
