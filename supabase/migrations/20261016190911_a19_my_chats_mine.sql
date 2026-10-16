-- A19 — my_chats says which last message is yours (16 Oct 2026).
--
-- The preview reads "You: …" for your own last message. The screen used to ask for your
-- person id separately to work that out — a second request on opening the tab, against
-- "one call for the whole screen". Now the answer carries it. Otherwise exactly
-- 20261016190532's function: SECURITY INVOKER, one call.

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
