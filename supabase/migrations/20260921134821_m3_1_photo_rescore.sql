-- Phase 3 M3.1 — re-judging photos after a rubric change (Alex).
--
-- **The rule this exists to keep** (decisions.md, "The comedy rubric, measured before
-- and after"): *a change to a rubric or a threshold ships together with the re-score
-- of whatever it has already judged.* Only new photos are checked as they arrive, so a
-- rubric change without a re-judge leaves two wordings' verdicts side by side under
-- one queue — and in this case leaves a real person's photo held by a rule that no
-- longer exists.
--
-- `admin_record_photo_check` cannot do this: it applies only to a photo still at
-- `pending`, deliberately, so a late answer never overwrites a decision. A re-judge is
-- the opposite case — the decision is exactly what is being revisited.
--
-- **It still never overrules a person.** `p_only_if_ai` is how: when true (always, for
-- a rubric change) the status moves only if the last decision on that photo came from
-- `ai:photo-check`. Alex approving something the check held is a person's judgement
-- about a real photo, and a later re-run of a prompt is not entitled to undo it. The
-- new verdict is still recorded as evidence; only the status is left alone.

alter table public.photo_checks drop constraint photo_checks_source_check;
alter table public.photo_checks add constraint photo_checks_source_check
  check (source in ('webhook', 'app', 'admin', 'eval', 'rescore'));

create function public.admin_rescore_photo(
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

  -- Who decided this photo last. No row at all means nobody has, which a re-judge may
  -- act on freely.
  select l.actor into decided_by
  from public.moderation_log l
  where l.person_id = p_person and l.action like 'photo\\_%'
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
  'Re-judge a photo after a rubric change. Records the new verdict always; moves the status only when the last decision was the check''s own, so a rescore never overrules a person.';

revoke execute on function public.admin_rescore_photo(uuid, text, text, text, text, numeric, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_rescore_photo(uuid, text, text, text, text, numeric, integer, boolean)
  to service_role;
