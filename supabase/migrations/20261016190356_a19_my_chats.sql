-- A19 — My Events is the home for your chats (Alex, 16 Oct 2026).
--
-- Every chat you belong to, one tap from the tab: for each event you have pinned, the
-- room ("Everyone going"), your squad, your 1-on-1 plan, and the squads open to you —
-- each with its last message, when it was said, and how many are unread. One call for
-- the whole screen (my_chats), never one per event or per chat.
--
-- **No new rule about who sees whom.** my_chats is SECURITY INVOKER: every row in it is
-- read as the person asking, under the policies already in force — their pins, their
-- rooms (my_rooms), the room's messages (room_messages_read), their groups and threads
-- (crew_members / crew_messages read rules), the names they may see (people), the
-- squads listed to them (squads), and A16's own state for a past night (after_state).
-- Whatever those refuse, my_chats does not show.
--
-- **Unread needs a "seen" time, and squads and 1-on-1 plans had none.** They get the
-- room's: crew_members.last_seen_at, set by crew_seen() when the thread is in view —
-- and, as with the room since L11 (R91), **nobody can read it through the API**, the
-- person included: a seen time other members could read is a read receipt. The count
-- reaches it through two helpers that answer only for the caller's own membership.
-- The owner's export (my_record_times) now carries both seen times, the room's too.
--
-- Retention (Q11): a chat is listed until 30 days after its read-only day begins
-- (effective end + 24 h + 30 days); after that the event stays, with no chat. Proved by
-- P248–P254.

-- ---------------------------------------------------------------------------
-- A seen time for squads and 1-on-1 plans, sealed like the room's
-- ---------------------------------------------------------------------------

alter table public.crew_members add column last_seen_at timestamptz;

revoke select on public.crew_members from authenticated;
grant select (id, crew_id, gathering_id, person_id, kind, seats, joined_at, left_at, arrived_at, arrival_note)
  on public.crew_members to authenticated;

create function public.crew_seen(p_crew uuid) returns void
language sql security definer set search_path = '' as $$
  update public.crew_members set last_seen_at = now()
  where crew_id = p_crew and person_id = private.me() and left_at is null;
$$;
revoke all on function public.crew_seen(uuid) from public, anon;
grant execute on function public.crew_seen(uuid) to authenticated;

-- The caller's own "seen" time in a room or a thread — never anyone else's. Falls back
-- to when they joined, so a room's history before they arrived is not "unread".
create function private.my_seen_in_room(p_room uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(m.last_seen_at, m.joined_at) from public.room_members m
  where m.room_id = p_room and m.person_id = private.me() and m.left_at is null;
$$;
revoke all on function private.my_seen_in_room(uuid) from public;
grant execute on function private.my_seen_in_room(uuid) to authenticated;

create function private.my_seen_in_crew(p_crew uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(m.last_seen_at, m.joined_at) from public.crew_members m
  where m.crew_id = p_crew and m.person_id = private.me() and m.left_at is null;
$$;
revoke all on function private.my_seen_in_crew(uuid) from public;
grant execute on function private.my_seen_in_crew(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The screen, in one call — as the person asking
-- ---------------------------------------------------------------------------

create function public.my_chats() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (
    select private.me() as id
  ),
  ev as (
    select p.gathering_id, p.open_to_meeting, g.slug, g.name, g.starts_at, g.ends_at, g.withdrawn_at,
           public.effective_end(g) as ends_eff, v.name as venue, c.timezone,
           now() >= public.effective_end(g) as past,
           now() < public.effective_end(g) + interval '24 hours' + interval '30 days' as chats_kept
    from public.pins p
    join public.gatherings g on g.id = p.gathering_id
    left join public.venues v on v.id = g.venue_id
    left join public.cities c on c.slug = v.city
    where p.person_id = (select id from me) and g.slug is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'gathering_id', ev.gathering_id,
    'slug', ev.slug,
    'name', ev.name,
    'venue', ev.venue,
    'timezone', ev.timezone,
    'starts_at', ev.starts_at,
    'ends_at', ev.ends_at,
    'ends_eff', ev.ends_eff,
    'withdrawn', ev.withdrawn_at is not null,
    'open_to_meeting', ev.open_to_meeting,
    'after', case when ev.past then public.after_state(ev.gathering_id) end,
    -- "Everyone going": my rooms here (the general one, and the women-only one if I am in it).
    'rooms', case when ev.chats_kept then coalesce((
      select jsonb_agg(jsonb_build_object(
        'room_id', r.room_id, 'number', r.number, 'women_only', r.women_only, 'members', r.members, 'open', r.open,
        'last', (
          select jsonb_build_object('body', m.body, 'at', m.created_at, 'author_id', m.author_id,
                                    'author', (select pe.first_name from public.people pe where pe.id = m.author_id))
          from public.room_messages m where m.room_id = r.room_id order by m.created_at desc limit 1
        ),
        'unread', (
          select count(*) from public.room_messages m
          where m.room_id = r.room_id and m.author_id <> (select id from me)
            and m.created_at > coalesce(private.my_seen_in_room(r.room_id), '-infinity'::timestamptz)
        )
      ) order by r.women_only)
      from public.my_rooms(ev.gathering_id) r
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- My squad and my 1-on-1 plan here (a call-off is no chat).
    'crews', case when ev.chats_kept then coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew_id', cr.id, 'kind', cr.kind, 'name', cr.name, 'legacy', cr.legacy, 'state', cr.state,
        'partner', case when cr.kind = 'solo' then (
          select pe.first_name from public.crew_members o join public.people pe on pe.id = o.person_id
          where o.crew_id = cr.id and o.person_id <> (select id from me) limit 1
        ) end,
        'last', (
          select jsonb_build_object('body', m.body, 'at', m.created_at, 'author_id', m.author_id,
                                    'author', (select pe.first_name from public.people pe where pe.id = m.author_id))
          from public.crew_messages m where m.crew_id = cr.id and m.kind = 'user' order by m.created_at desc limit 1
        ),
        'unread', (
          select count(*) from public.crew_messages m
          where m.crew_id = cr.id and m.kind = 'user' and m.author_id is distinct from (select id from me)
            and m.created_at > coalesce(private.my_seen_in_crew(cr.id), '-infinity'::timestamptz)
        )
      ) order by cr.kind)
      from public.crew_members cm join public.crews cr on cr.id = cm.crew_id
      where cm.person_id = (select id from me) and cm.gathering_id = ev.gathering_id and cm.left_at is null
        and cr.state <> 'dissolved'
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- Squads I could join and haven't: what squads() lists to me, before the night ends.
    'open_squads', case when not ev.past and ev.withdrawn_at is null then coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew_id', s.crew_id, 'name', s.name, 'women_only', s.women_only, 'spot', s.spot,
        'meet_at', s.meet_at, 'seats', s.seats, 'full', s.is_full
      ) order by s.is_full, s.meet_at)
      from public.squads(ev.gathering_id) s
      where not exists (
        select 1 from public.crew_members cm
        where cm.crew_id = s.crew_id and cm.person_id = (select id from me) and cm.left_at is null
      )
    ), '[]'::jsonb) else '[]'::jsonb end
  ) order by ev.starts_at), '[]'::jsonb)
  from ev;
$$;
revoke all on function public.my_chats() from public, anon;
grant execute on function public.my_chats() to authenticated;

-- ---------------------------------------------------------------------------
-- The export holds both seen times (everything we hold about you)
-- ---------------------------------------------------------------------------

create or replace function public.my_record_times() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'joined_at', (select p.created_at from public.people p where p.id = private.me()),
    'pins', coalesce((
      select jsonb_agg(jsonb_build_object('gathering_id', x.gathering_id, 'pinned_at', x.created_at, 'changed_at', x.updated_at) order by x.created_at)
      from public.pins x where x.person_id = private.me()
    ), '[]'::jsonb),
    'rooms_seen', coalesce((
      select jsonb_agg(jsonb_build_object('room_id', m.room_id, 'last_seen_at', m.last_seen_at) order by m.joined_at)
      from public.room_members m where m.person_id = private.me() and m.last_seen_at is not null
    ), '[]'::jsonb),
    'threads_seen', coalesce((
      select jsonb_agg(jsonb_build_object('crew_id', m.crew_id, 'last_seen_at', m.last_seen_at) order by m.joined_at)
      from public.crew_members m where m.person_id = private.me() and m.last_seen_at is not null
    ), '[]'::jsonb)
  );
$$;
