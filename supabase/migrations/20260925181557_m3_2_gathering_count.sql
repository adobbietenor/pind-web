-- M3.2 — a person's gathering count, for A22 (Alex, M3.2).
--
-- A22 answers "nothing to read" with the shared context, all tags grouped, and **how
-- many gatherings someone has been to — a number, never which ones**. A stranger seeing
-- a pattern of where somebody goes is new visibility, against Part 4 (Alex).
--
-- It cannot be counted from pins: pins are deleted 30 days after each gathering
-- (decisions Part 3), and "gatherings-attended counts persist". So it is **its own
-- number on the person**, added to once per gathering after that gathering ends:
--
--   * `people.gatherings_count` — on the people row, so it is readable exactly as the
--     first name is: by the person, and by anyone who can already see them (V1).
--     Nobody else, and never a list of gatherings (P119, P120);
--   * **nobody signed in can write it** — `people`'s write grants are per column and
--     this column is in none of them (P121);
--   * `admin_count_ended_gatherings()` adds one for each person pinned at each
--     published, not-withdrawn gathering whose effective end has passed, **once** —
--     `gatherings.counted_at` marks it done (P122). pg_cron runs it nightly, long
--     before the 30-day pin deletion (M4.5).

alter table public.people add column gatherings_count integer not null default 0;
comment on column public.people.gatherings_count is
  'Gatherings this person was pinned to that have ended. A number only, never which (A22, M3.2). Written by admin_count_ended_gatherings.';

alter table public.gatherings add column counted_at timestamptz;
comment on column public.gatherings.counted_at is
  'When this gathering was added to its people''s gatherings_count (once).';

create function public.admin_count_ended_gatherings() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_done integer := 0;
  v_g record;
begin
  for v_g in
    select g.id from public.gatherings g
    where g.counted_at is null
      and g.published_at is not null
      and g.withdrawn_at is null
      and public.effective_end(g) < now()
    for update skip locked
  loop
    update public.people p set gatherings_count = p.gatherings_count + 1
    where p.id in (select pi.person_id from public.pins pi where pi.gathering_id = v_g.id);
    update public.gatherings set counted_at = now() where id = v_g.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.admin_count_ended_gatherings() from public, anon, authenticated;
grant execute on function public.admin_count_ended_gatherings() to service_role;

-- Nightly, after the 08:00 import.
select cron.schedule('pind-gathering-counts', '30 9 * * *', $$select public.admin_count_ended_gatherings()$$);

-- The gatherings that have already ended, counted now.
select public.admin_count_ended_gatherings();
