-- A16 / A20 — keep in touch is a request and an accept, like 1-on-1 (UI pass 1, group 2 B;
-- Alex, 30 Oct 2026, decision 2 and calls d and e). It replaces Q6's invisible mutual ticks
-- (decisions, "UI pass 1: the screen review and what it decided").
--
-- The rule, in plain English (approved before this was written):
--   * From the gathering's effective end until 7 days after it, you can ask someone you
--     crossed paths with there to keep in touch: someone in your squad or your 1-on-1, or
--     someone in your room **when both of you said something in it** (call d).
--   * Only they see the request, in Connections → Requests: your first name, your photo if
--     they may see it, and where you met. They accept, or say "Not now".
--   * Accept makes a connection on both sides. **"Not now" is silent**: your side still
--     reads "Sent", and you cannot ask again. At 7 days an unanswered request lapses
--     silently. You can take yours back until it is answered.
--   * If you both ask, you are connected at once.
--   * A block either way cancels a waiting request and refuses a new one; nobody hidden
--     asks or is asked.
--   * The "showed up" badge comes from an accepted keep-in-touch (call e). A badge already
--     earned by a matched "we met" stays.
--
-- How the database holds it: its own table, RLS on and no grants; the functions below are
-- the only door. The old ticks (confirmations) are left as they are, read only by the badge.

create type public.keep_status as enum ('open', 'accepted', 'declined', 'withdrawn');

create table public.keep_requests (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  from_person   uuid not null references public.people (id) on delete cascade,
  to_person     uuid not null references public.people (id) on delete cascade,
  status        public.keep_status not null default 'open',
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  unique (gathering_id, from_person, to_person),
  constraint keep_requests_not_self check (from_person <> to_person)
);
alter table public.keep_requests enable row level security;
revoke all on public.keep_requests from public, anon, authenticated;
create index keep_requests_to_idx on public.keep_requests (to_person, status);

alter table public.connections add column source_gathering_id uuid references public.gatherings (id) on delete set null;
comment on column public.connections.source_gathering_id is 'Where a keep-in-touch was asked (UI pass 1); a room has no crew to point at.';

-- Where two people crossed paths at a gathering: '1-on-1', 'squad', 'room' (both posted in
-- the same room), or null.
create function private.crossed_paths(p_a uuid, p_b uuid, p_gathering uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when c.kind = 'solo' then '1-on-1' else 'squad' end
     from public.crew_members a
     join public.crew_members b on b.crew_id = a.crew_id
     join public.crews c on c.id = a.crew_id
     where a.gathering_id = p_gathering and a.person_id = p_a and b.person_id = p_b
       and a.left_at is null and b.left_at is null and c.state <> 'dissolved' and c.hidden_at is null
     order by c.kind = 'solo' desc
     limit 1),
    (select 'room'
     from public.room_members a
     join public.room_members b on b.room_id = a.room_id
     where a.gathering_id = p_gathering and a.person_id = p_a and b.person_id = p_b
       and a.first_posted_at is not null and b.first_posted_at is not null
     limit 1)
  );
$$;
revoke all on function private.crossed_paths(uuid, uuid, uuid) from public, anon, authenticated;

create function private.keep_window_open(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select now() >= public.effective_end(g) and now() < public.effective_end(g) + interval '7 days'
                   from public.gatherings g where g.id = p_gathering), false);
$$;
revoke all on function private.keep_window_open(uuid) from public, anon, authenticated;

create function private.keep_connect(p_a uuid, p_b uuid, p_gathering uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.connections (person_a, person_b, source_crew_id, source_gathering_id)
  values (
    least(p_a, p_b), greatest(p_a, p_b),
    (select a.crew_id from public.crew_members a join public.crew_members b on b.crew_id = a.crew_id
     where a.gathering_id = p_gathering and a.person_id = p_a and b.person_id = p_b limit 1),
    p_gathering
  )
  on conflict (person_a, person_b) do nothing;
end;
$$;
revoke all on function private.keep_connect(uuid, uuid, uuid) from public, anon, authenticated;

create function public.ask_keep(p_gathering uuid, p_to uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_theirs public.keep_requests;
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  perform private.lock_people(array[v_me, p_to]);
  if not private.keep_window_open(p_gathering) then
    raise exception 'refused: keep in touch is open for 7 days after the event' using errcode = '42501', hint = 'keep_window';
  end if;
  if private.crossed_paths(v_me, p_to, p_gathering) is null then
    raise exception 'refused: you did not meet there' using errcode = '42501', hint = 'keep_not_met';
  end if;
  if private.blocked_between(v_me, p_to) or private.is_hidden(v_me)
     or exists (select 1 from public.people p where p.id = p_to and p.hidden_at is not null) then
    raise exception 'refused: not available' using errcode = '42501', hint = 'keep_unavailable';
  end if;
  if private.are_connected(p_to) then
    return 'connected';
  end if;
  -- They asked first: both asked, so connected at once.
  select * into v_theirs from public.keep_requests
  where gathering_id = p_gathering and from_person = p_to and to_person = v_me and status = 'open' for update;
  if v_theirs.id is not null then
    update public.keep_requests set status = 'accepted', decided_at = now() where id = v_theirs.id;
    insert into public.keep_requests (gathering_id, from_person, to_person, status, decided_at)
    values (p_gathering, v_me, p_to, 'accepted', now())
    on conflict (gathering_id, from_person, to_person) do update set status = 'accepted', decided_at = now();
    perform private.keep_connect(v_me, p_to, p_gathering);
    return 'connected';
  end if;
  -- Once per pair per gathering: a "Not now" or a take-back is not asked again.
  insert into public.keep_requests (gathering_id, from_person, to_person)
  values (p_gathering, v_me, p_to)
  on conflict (gathering_id, from_person, to_person) do nothing;
  return 'sent';
end;
$$;

create function public.take_back_keep(p_gathering uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.keep_requests set status = 'withdrawn', decided_at = now()
  where gathering_id = p_gathering and from_person = private.me() and to_person = p_to and status = 'open';
  if not found then
    raise exception 'refused: nothing to take back' using errcode = '42501', hint = 'keep_not_open';
  end if;
end;
$$;

create function public.answer_keep(p_request uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_r public.keep_requests;
begin
  select * into v_r from public.keep_requests where id = p_request and to_person = v_me and status = 'open' for update;
  if v_me is null or v_r.id is null then
    raise exception 'refused: not a request to you' using errcode = '42501', hint = 'keep_not_open';
  end if;
  if not private.keep_window_open(v_r.gathering_id) then
    raise exception 'refused: keep in touch is open for 7 days after the event' using errcode = '42501', hint = 'keep_window';
  end if;
  if private.blocked_between(v_me, v_r.from_person) then
    raise exception 'refused: not available' using errcode = '42501', hint = 'keep_unavailable';
  end if;
  if coalesce(p_accept, false) then
    update public.keep_requests set status = 'accepted', decided_at = now() where id = v_r.id;
    perform private.keep_connect(v_me, v_r.from_person, v_r.gathering_id);
  else
    update public.keep_requests set status = 'declined', decided_at = now() where id = v_r.id;
  end if;
end;
$$;

-- A20's Requests: what is waiting for me, inside its window, from someone I can still be
-- asked by.
create function public.my_keep_requests() returns table (
  request_id uuid, gathering_id uuid, gathering_name text, person_id uuid, first_name text, photo_path text, met_as text, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, g.id, g.name, o.id, o.first_name,
         case when o.photo_path is not null and private.can_see_photo(o.photo_path) then o.photo_path end,
         private.crossed_paths(private.me(), o.id, g.id), r.created_at
  from public.keep_requests r
  join public.gatherings g on g.id = r.gathering_id
  join public.people o on o.id = r.from_person
  where r.to_person = private.me() and r.status = 'open'
    and private.keep_window_open(g.id)
    and not private.blocked_between(r.from_person, r.to_person)
    and o.hidden_at is null
  order by r.created_at;
$$;

-- A16's cards: everyone I crossed paths with there, where, and where things stand between
-- us — 'connected', 'sent' (open or "Not now"-ed: the same to me), 'asked_me', or 'none'.
create function public.keep_people(p_gathering uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if v_me is null then return null; end if;
  return jsonb_build_object(
    'open', private.keep_window_open(p_gathering),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', x.id,
        'first_name', x.first_name,
        'photo_path', case when x.photo_path is not null and private.can_see_photo(x.photo_path) then x.photo_path end,
        'met_as', x.met_as,
        'state', case
          when private.are_connected(x.id) then 'connected'
          when exists (select 1 from public.keep_requests r where r.gathering_id = p_gathering and r.from_person = v_me and r.to_person = x.id and r.status in ('open', 'declined')) then 'sent'
          when exists (select 1 from public.keep_requests r where r.gathering_id = p_gathering and r.from_person = x.id and r.to_person = v_me and r.status = 'open') then 'asked_me'
          else 'none' end
      ) order by x.met_as, x.first_name)
      from (
        select pe.id, pe.first_name, pe.photo_path, private.crossed_paths(v_me, pe.id, p_gathering) as met_as
        from public.people pe
        where pe.id <> v_me and pe.hidden_at is null and not private.blocked_between(v_me, pe.id)
          and pe.id in (
            select m.person_id from public.crew_members m where m.gathering_id = p_gathering
            union
            select rm.person_id from public.room_members rm where rm.gathering_id = p_gathering and rm.first_posted_at is not null
          )
      ) x
      where x.met_as is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.ask_keep(uuid, uuid), public.take_back_keep(uuid, uuid), public.answer_keep(uuid, boolean),
  public.my_keep_requests(), public.keep_people(uuid) from public, anon;
grant execute on function public.ask_keep(uuid, uuid), public.take_back_keep(uuid, uuid), public.answer_keep(uuid, boolean),
  public.my_keep_requests(), public.keep_people(uuid) to authenticated;

-- A block cancels what is waiting between the two, either way.
create function private.blocks_cancel_keep() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.keep_requests set status = 'withdrawn', decided_at = now()
  where status = 'open'
    and ((from_person = new.blocker_id and to_person = new.blocked_id) or (from_person = new.blocked_id and to_person = new.blocker_id));
  return new;
end;
$$;
revoke all on function private.blocks_cancel_keep() from public;
create trigger blocks_cancel_keep after insert on public.blocks
  for each row execute function private.blocks_cancel_keep();

-- The "showed up" badge: an accepted keep-in-touch (call e), or a matched "we met" from
-- before. Readable for yourself and for anyone you can see.
create or replace function public.showed_up(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_person = private.me() or private.can_see(p_person))
     and (
       exists (select 1 from public.keep_requests r where r.status = 'accepted' and p_person in (r.from_person, r.to_person))
       or exists (
         select 1 from public.confirmations a
         join public.confirmations b on b.crew_id = a.crew_id and b.from_person = a.to_person and b.to_person = a.from_person and b.kind = a.kind
         where a.from_person = p_person and a.kind = 'we_met'
       )
     );
$$;

-- Where you met, for a connection made in a room (no crew to point at).
create or replace function public.my_connections()
returns table (person_id uuid, first_name text, photo_path text, met_at text, gathering_id uuid, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select pe.id, pe.first_name,
         case when pe.photo_status <> 'rejected' then pe.photo_path end,
         coalesce(g.name, g2.name), coalesce(g.id, g2.id), c.created_at
  from public.connections c
  join public.people pe on pe.id = case when c.person_a = private.me() then c.person_b else c.person_a end
  left join public.crews cr on cr.id = c.source_crew_id
  left join public.gatherings g on g.id = cr.gathering_id
  left join public.gatherings g2 on g2.id = c.source_gathering_id
  where private.me() in (c.person_a, c.person_b)
    and pe.hidden_at is null
    and not private.blocked_between(private.me(), pe.id)
  order by c.created_at desc;
$$;
