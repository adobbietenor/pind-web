-- A9 — "I'm here" on the night, for the room and your squad at once (UI pass 1, 088;
-- Alex, 30 Oct 2026, group 2 calls D and g).
--
-- The rule, in plain English (approved before this was written):
--   * From 3 hours before the start until the gathering's effective end, someone open to
--     meeting there can switch "I'm here" on. It asks for Q7's one line ("green Matthews
--     jersey"): 1 to 80 characters, never blank. It switches itself off at the effective
--     end (every read stops showing it then), or when they switch it off.
--   * Who sees that you are here, and your line: only people who share a room or a squad
--     with you at that gathering, and who can see you there at all (can_see_at: no block
--     either way, nobody hidden). Nobody else, ever; never on a public page.
--   * "N here now": a number, to anyone pinned to that gathering. Never who.
--   * One switch: it also marks you arrived in your squad there (A13's crew_members
--     arrival), and switching it off clears both.
--
-- How the database holds it: its own table, RLS on and no grants at all, so nothing reads
-- it but the three functions below. A row goes with the pin (on delete cascade).

create table public.arrivals (
  gathering_id  uuid not null,
  person_id     uuid not null,
  arrived_at    timestamptz not null default now(),
  note          text not null check (char_length(btrim(note)) between 1 and 80),
  primary key (gathering_id, person_id),
  foreign key (gathering_id, person_id) references public.pins (gathering_id, person_id) on delete cascade
);
alter table public.arrivals enable row level security;
revoke all on public.arrivals from public, anon, authenticated;
comment on table public.arrivals is
  'A9''s night-of "I''m here" (UI pass 1). Read only through here_now; written only through set_here / clear_here.';

-- Do two people share a room (both still in it) or a squad (both still in it) here?
create function private.share_room_or_squad(p_a uuid, p_b uuid, p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members a join public.room_members b on b.room_id = a.room_id
    where a.gathering_id = p_gathering and a.person_id = p_a and b.person_id = p_b
      and a.left_at is null and b.left_at is null
  ) or exists (
    select 1 from public.crew_members a
    join public.crew_members b on b.crew_id = a.crew_id
    join public.crews c on c.id = a.crew_id
    where a.gathering_id = p_gathering and a.person_id = p_a and b.person_id = p_b
      and a.left_at is null and b.left_at is null and c.state <> 'dissolved'
  );
$$;
revoke all on function private.share_room_or_squad(uuid, uuid, uuid) from public, anon, authenticated;

create function public.set_here(p_gathering uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_g public.gatherings;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  select * into v_g from public.gatherings where id = p_gathering;
  if v_g.id is null then raise exception 'refused: no such gathering' using errcode = '42501'; end if;
  if not exists (select 1 from public.pins where gathering_id = p_gathering and person_id = v_me and open_to_meeting) then
    raise exception 'refused: not open to meeting here' using errcode = '42501', hint = 'here_not_open';
  end if;
  if now() < v_g.starts_at - interval '3 hours' or now() >= public.effective_end(v_g) then
    raise exception 'refused: not on the night' using errcode = '42501', hint = 'here_window';
  end if;
  if char_length(v_note) not between 1 and 80 then
    raise exception 'refused: say what you are wearing' using errcode = '22023', hint = 'here_note';
  end if;
  insert into public.arrivals (gathering_id, person_id, note) values (p_gathering, v_me, v_note)
  on conflict (gathering_id, person_id) do update set note = excluded.note;
  -- The same switch in your squad (A13), while it is live.
  update public.crew_members m set arrived_at = coalesce(m.arrived_at, now()), arrival_note = v_note
  from public.crews c
  where c.id = m.crew_id and m.gathering_id = p_gathering and m.person_id = v_me and m.left_at is null and c.state = 'live';
end;
$$;

create function public.clear_here(p_gathering uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  delete from public.arrivals where gathering_id = p_gathering and person_id = v_me;
  update public.crew_members set arrived_at = null, arrival_note = null
  where gathering_id = p_gathering and person_id = v_me and left_at is null and arrived_at is not null;
end;
$$;

-- What the night's page reads: how many are here (to anyone pinned there), whether I am
-- and my line, and who else is here with their lines (only those I share a room or a
-- squad with and can see). Nothing after the effective end.
create function public.here_now(p_gathering uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_g public.gatherings;
begin
  if v_me is null or not exists (select 1 from public.pins where gathering_id = p_gathering and person_id = v_me) then
    raise exception 'refused: not pinned here' using errcode = '42501';
  end if;
  select * into v_g from public.gatherings where id = p_gathering;
  if now() >= public.effective_end(v_g) then
    return jsonb_build_object('count', 0, 'me', null, 'people', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'count', (select count(*) from public.arrivals a
              join public.pins p on p.gathering_id = a.gathering_id and p.person_id = a.person_id and p.open_to_meeting
              where a.gathering_id = p_gathering),
    'me', (select a.note from public.arrivals a where a.gathering_id = p_gathering and a.person_id = v_me),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', a.person_id, 'first_name', pe.first_name, 'note', a.note) order by a.arrived_at)
      from public.arrivals a
      join public.people pe on pe.id = a.person_id
      join public.pins p on p.gathering_id = a.gathering_id and p.person_id = a.person_id and p.open_to_meeting
      where a.gathering_id = p_gathering and a.person_id <> v_me
        and private.share_room_or_squad(v_me, a.person_id, p_gathering)
        and private.can_see_at(a.person_id, p_gathering)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.set_here(uuid, text), public.clear_here(uuid), public.here_now(uuid) from public, anon;
grant execute on function public.set_here(uuid, text), public.clear_here(uuid), public.here_now(uuid) to authenticated;
