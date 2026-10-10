-- M4.2 — Q37 and Q07 together: one cause, the whole-row read grant on people (and pins).
--
-- Q37 (V6 §8; Alex, 10 Oct 2026: "'Held for review' means 'possible minor' under our own
-- moderation rule, so a stranger seeing that status — and being able to search for it —
-- is a signal pointing at minors"): anyone who could see a person read their
-- photo_status — needs_review (a possible minor), rejected (nudity, hate imagery or gore) —
-- and could FILTER people by it; the owner read their own needs_review, which §8 says is
-- told to nobody, ever.
--
-- Q07 (V3, §5 "never ordered by join time"): anyone who could see a person read when they
-- joined (people.created_at) and when they pinned or opted in (pins.created_at,
-- updated_at), so the list could be ordered by join time.
--
-- The fix: reads of people and pins are granted column by column, leaving out
-- photo_status and the timestamps. A column a client cannot select it cannot filter or
-- order by either, so the search for "needs_review" goes too. The rows a person can read
-- are unchanged — that is still RLS (V1); this narrows what is on them.
--
-- The owner keeps exactly what §8 says they are told, through one function that reads
-- only their own row: whether their photo was rejected (true/false — never needs_review,
-- never pending), and, for the data export, when they joined and pinned.
--
-- The service key (the Worker's admin, crons, AI jobs) is unaffected. Proved by P196–P198;
-- Q07 and Q37 in the review suite turn green, and P24 now asserts the refusal.

revoke select on public.people from authenticated;
grant select (id, auth_user_id, first_name, last_initial, neighbourhood, photo_path, gatherings_count, hidden_at, is_seed)
  on public.people to authenticated;

revoke select on public.pins from authenticated;
grant select (id, gathering_id, person_id, party_total, open_to_meeting)
  on public.pins to authenticated;

-- What §8 tells the owner: rejected, or not. Nothing else about the check.
create function public.my_photo_rejected() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.photo_status = 'rejected' from public.people p where p.id = private.me()), false);
$$;
revoke all on function public.my_photo_rejected() from public;
grant execute on function public.my_photo_rejected() to authenticated;

-- The owner's own timestamps, for "export my data" (everything we hold about you).
create function public.my_record_times() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'joined_at', (select p.created_at from public.people p where p.id = private.me()),
    'pins', coalesce((
      select jsonb_agg(jsonb_build_object('gathering_id', x.gathering_id, 'pinned_at', x.created_at, 'changed_at', x.updated_at) order by x.created_at)
      from public.pins x where x.person_id = private.me()
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.my_record_times() from public;
grant execute on function public.my_record_times() to authenticated;
