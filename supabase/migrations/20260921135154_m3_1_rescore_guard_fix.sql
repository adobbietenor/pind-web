-- Phase 3 M3.1 — the rescore's "never overrule a person" guard never ran.
--
-- **What happened.** The guard asks who decided a photo last, by finding that
-- person's most recent `moderation_log` row whose action starts `photo_`. It was
-- written `like 'photo\\_%'`. With `standard_conforming_strings` on — the default,
-- and what this database uses — that is a literal **backslash** followed by an
-- underscore, so it matched **nothing**, `decided_by` came back null for every photo,
-- and the guard concluded that nobody had ever decided any of them.
--
-- The first `--write` therefore did exactly what the function was built to prevent:
-- it overwrote four photos Alex had rejected by hand minutes earlier, and attributed
-- the change to `ai:photo-check`. They were seed rows, so no real person's photo was
-- affected — but the failure is not smaller for that, and the reason it went unnoticed
-- is worth more than the fix: **the guard's success and its failure look identical
-- from outside.** A guard that passes because it found nothing to stop reports the
-- same "now approved" as a guard that correctly found nothing to stop.
--
-- So the fix comes with a harness case (P81) that puts a human decision in front of a
-- rescore and proves the status does not move. A safety rule with no test proving it
-- fires is a comment.
--
-- `\_` is the right escape here: LIKE treats an unescaped `_` as "any character", and
-- `photo_approved` would match `photo` + anything either way — but `photo_%` would
-- also match a future action like `photograph_x`, and being exact costs nothing.

create or replace function public.admin_rescore_photo(
  p_person       uuid,
  p_photo_path   text,
  p_outcome      text,
  p_reason       text default null,
  p_model        text default null,
  p_cost         numeric default 0,
  p_duration_ms  integer default null,
  p_only_if_ai   boolean default true
) returns text
language plpgsql set search_path = '' as $fn$
declare
  decided_by text;
  applied    public.photo_status;
begin
  insert into public.photo_checks
    (person_id, photo_path, outcome, source, reason, model, ai_cost_usd, duration_ms)
  values
    (p_person, p_photo_path, p_outcome, 'rescore', p_reason, p_model, coalesce(p_cost, 0), p_duration_ms);

  if p_outcome = 'failed' then
    return 'the check failed';
  end if;

  select l.actor into decided_by
  from public.moderation_log l
  where l.person_id = p_person
    and l.action in ('photo_approved', 'photo_rejected', 'photo_needs_review')
  order by l.at desc
  limit 1;

  if p_only_if_ai and decided_by is not null and decided_by <> 'ai:photo-check' then
    return 'left alone: ' || decided_by || ' decided this one';
  end if;

  update public.people
  set photo_status = p_outcome::public.photo_status
  where id = p_person and photo_path = p_photo_path
  returning photo_status into applied;

  if applied is null then
    return 'the photo has changed since';
  end if;

  insert into public.moderation_log (actor, action, person_id, note)
  values ('ai:photo-check', 'photo_' || p_outcome, p_person, 'rescored: ' || left(coalesce(p_reason, ''), 400));
  return 'now ' || applied::text;
end;
$fn$;

comment on function public.admin_rescore_photo(uuid, text, text, text, text, numeric, integer, boolean) is
  'Re-judge a photo after a rubric change. Records the new verdict always; moves the status only when the last decision was the check''s own, so a rescore never overrules a person. The actor check matches the three photo actions by name — a LIKE pattern here once matched nothing and the guard silently never fired.';
