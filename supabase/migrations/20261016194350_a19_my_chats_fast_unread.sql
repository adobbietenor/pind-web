-- A19 — my_chats, fast: unread is counted from the seen time, not across the whole thread
-- (16 Oct 2026).
--
-- Measured in real Chrome (npm run measure:thread): my_chats took ~650 ms a call, against
-- ~200 ms for the four reads the old list made — so the tab would have opened slower. The
-- cost was the unread count: it put every message in the room through the room's read rule
-- (~2 ms a message under RLS) and only then compared times, because its lower bound was a
-- function call inside coalesce() in the WHERE, which the planner cannot use to seek. Now the
-- seen time is read once per chat (a lateral beside it), so the index on (room_id,
-- created_at) / (crew_id, created_at) starts at it and only newer messages meet the read
-- rule; and the count stops at 100 (the badge says 99+), so a thread left unopened for weeks
-- cannot cost more than that. Same reads, same rules — still SECURITY INVOKER, one call.
-- Otherwise exactly 20261016190911's function.

create or replace function public.my_chats() returns jsonb
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
                                    'mine', m.author_id = (select id from me),
                                    'author', (select pe.first_name from public.people pe where pe.id = m.author_id))
          from public.room_messages m where m.room_id = r.room_id order by m.created_at desc limit 1
        ),
        'unread', (
          select count(*) from (
            select 1 from public.room_messages m
            where m.room_id = r.room_id and m.created_at > seen.at and m.author_id <> (select id from me)
            limit 100
          ) u
        )
      ) order by r.women_only)
      from public.my_rooms(ev.gathering_id) r
      cross join lateral (select coalesce(private.my_seen_in_room(r.room_id), '-infinity'::timestamptz) as at) seen
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- My squad and my 1-on-1 plan here (a call-off is no chat).
    'crews', case when ev.chats_kept then coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew_id', cr.id, 'kind', cr.kind, 'name', cr.name, 'legacy', cr.legacy, 'state', cr.state,
        'meet_at', cr.meet_at,
        'spot', (select sp.name from public.meeting_spots sp where sp.id = cr.spot_id),
        'partner', case when cr.kind = 'solo' then (
          select pe.first_name from public.crew_members o join public.people pe on pe.id = o.person_id
          where o.crew_id = cr.id and o.person_id <> (select id from me) limit 1
        ) end,
        'last', (
          select jsonb_build_object('body', m.body, 'at', m.created_at, 'author_id', m.author_id,
                                    'mine', m.author_id = (select id from me),
                                    'author', (select pe.first_name from public.people pe where pe.id = m.author_id))
          from public.crew_messages m where m.crew_id = cr.id and m.kind = 'user' order by m.created_at desc limit 1
        ),
        'unread', (
          select count(*) from (
            select 1 from public.crew_messages m
            where m.crew_id = cr.id and m.created_at > seen.at and m.kind = 'user' and m.author_id is distinct from (select id from me)
            limit 100
          ) u
        )
      ) order by cr.kind)
      from public.crew_members cm join public.crews cr on cr.id = cm.crew_id
      cross join lateral (select coalesce(private.my_seen_in_crew(cr.id), '-infinity'::timestamptz) as at) seen
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
