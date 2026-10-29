-- M4.2 follow-up (29 Oct 2026): the morning-after push (#5) asks "Did you meet up?" of
-- everyone who still has "Who did you meet?" — including someone who left a finished group
-- by blocking and keeps its ticks (V23, 20261029143155). P174 caught it: Ann blocked Ben in
-- P172 and was then asked the no-group question about a night she had a group for.
-- (admin_next_morning_tick as 20260929031538, with that one subquery changed.)

create or replace function public.admin_next_morning_tick(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.notifications (person_id, kind, gathering_id, crew_id, title, body, path)
  select pi.person_id, 'next_morning', g.id, cm.crew_id, g.name,
         case when cm.crew_id is not null
           then 'Did you meet up at ' || g.name || '? Tick who you met.'
           else 'How was ' || g.name || '? One quick question, if you have a second.' end,
         '/after/' || coalesce(g.slug, g.id::text)
  from public.gatherings g
  join public.pins pi on pi.gathering_id = g.id and pi.open_to_meeting
  join public.people pe on pe.id = pi.person_id and pe.hidden_at is null
  left join lateral (
    -- In a finished group, or kept by a block (V23, 20261029143155): the same people who
    -- still have "Who did you meet?" are asked "Did you meet up?".
    select c.id as crew_id from public.crews c
    where c.gathering_id = g.id and c.state = 'done' and private.in_after_group(pi.person_id, c.id)
    limit 1
  ) cm on true
  where g.published_at is not null and g.withdrawn_at is null
    and g.starts_at between p_now - interval '4 days' and p_now
    and p_now >= private.next_morning_at(g.id)
    and p_now < private.next_morning_at(g.id) + interval '1 day'
    and private.wants(pi.person_id, 'next_morning')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
