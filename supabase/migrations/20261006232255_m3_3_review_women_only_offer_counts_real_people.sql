-- M3.3 — the independent review, L5 (R83): the women-only offer counts only real people
-- (Alex, 6 Oct 2026).
--
-- `women_only_open` (V5, M1.1) counted every eligible person opted in at a gathering,
-- seed people included. So two real women and one seed person at a real gathering were
-- told "the women-only room is open" when its third member was not a person. Placement
-- already refuses a seed person at a real gathering (20261006230942); this is the count
-- the offer reads. A seed person still counts at a seed gathering — the test crowd's
-- testers-only world, where the seed people are the point (V18's testers exception).

create or replace function private.women_only_open(p_gathering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.i_am_open_at(p_gathering)
     and private.is_women_only_eligible(private.me())
     and (
       select count(*)
       from public.pins pi
       join public.people pe on pe.id = pi.person_id
       join public.gatherings g on g.id = pi.gathering_id
       where pi.gathering_id = p_gathering
         and pi.open_to_meeting
         and pe.hidden_at is null
         and (not pe.is_seed or g.is_seed)
         and private.is_women_only_eligible(pi.person_id)
     ) >= 3;
$$;
