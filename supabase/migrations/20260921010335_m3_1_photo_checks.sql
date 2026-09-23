-- Phase 3 M3.1 — the automated photo check: its record, its spend, and its counters.
--
-- **Why a record per attempt and not just a status.** M2.3's maps: 29 of 37 venues had
-- no picture and nothing noticed, because "never fetched" leaves no failure row — it
-- was neither ready nor failing, so it read as fine. **Unset is a different state from
-- broken.** A photo check has the same three-way shape, so every attempt writes a row
-- here whatever happened, and the admin counts the three states apart:
--
--   waiting for a human   status = 'needs_review'      the check could not tell
--   never checked         status = 'pending', no row   nothing has looked yet
--   check failing         status = 'pending', rows     every attempt errored
--
-- A failed check is deliberately not a status (previous migration): it is not a
-- decision and it is not waiting on a person, it is an operational fault, and it
-- belongs in front of whoever can fix it rather than in a queue a human is asked to
-- clear.
--
-- **Why the spend joins admin_ai_spend_today in the same migration that creates the
-- table.** That function already sums two tables, because M2.3's liveness check spent
-- money the $3/day cap could not see — one job's cost invisible to the cap turns a
-- hard cap into a suggestion. A third job recording its spend nowhere would do it
-- again, so the function is replaced here rather than in a later commit.
--
-- **An aborted call is counted** (M1.3b's cost blind spot): an aborted call is still
-- billed and its usage never arrives, so the caller writes an estimate into
-- `ai_cost_usd` with `outcome = 'failed'`.

create table public.photo_checks (
  id           bigint generated always as identity primary key,
  -- Null only for an evaluation run against the labelled set, which has no person.
  person_id    uuid references public.people (id) on delete cascade,
  photo_path   text not null,
  at           timestamptz not null default now(),
  -- 'failed' is the check itself failing: an error, a timeout, or a refusal to start.
  outcome      text not null check (outcome in ('approved', 'rejected', 'needs_review', 'failed')),
  -- The model's one-line reason. Never shown to the person.
  reason       text,
  model        text,
  ai_cost_usd  numeric(10, 6) not null default 0 check (ai_cost_usd >= 0),
  duration_ms  integer,
  error        text,
  source       text not null check (source in ('webhook', 'app', 'admin', 'eval')),
  -- A person is required for every real check; only an eval run may omit one.
  constraint photo_checks_person_unless_eval
    check (person_id is not null or source = 'eval')
);

comment on table public.photo_checks is
  'One row per attempt at checking a photo, including the attempts that failed. A check that never ran leaves no row, which is why the admin counts "never checked" separately from "check failing" - unset is a different state from broken.';

create index photo_checks_person_idx on public.photo_checks (person_id, at desc);
create index photo_checks_at_idx on public.photo_checks (at desc);

alter table public.photo_checks enable row level security;
revoke all on public.photo_checks from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Today's AI spend, across every job that spends it — now three tables.
-- ---------------------------------------------------------------------------
--
-- **The one honest wrinkle, stated rather than hidden.** `import_runs` and
-- `community_check_runs` each carry a city. A photo check does not, and cannot: a
-- person is not scoped to a city, and `people.neighbourhood` leads to
-- `neighbourhoods`, which has no city either. So photo spend counts against **every**
-- city's day. With one city that is exact. **With a second city it would double-count,
-- and that is the moment to decide what a photo check belongs to** — most likely the
-- city whose crowd the person pinned to first.
create or replace function public.admin_ai_spend_today(p_city text) returns numeric
language sql stable set search_path = '' as $fn$
  select
    coalesce((
      select sum(r.ai_cost_usd)
      from public.import_runs r, public.cities c
      where c.slug = p_city
        and (r.started_at at time zone c.timezone)::date = (now() at time zone c.timezone)::date
    ), 0)
    +
    coalesce((
      select sum(r.ai_cost_usd)
      from public.community_check_runs r, public.cities c
      where c.slug = p_city
        and r.city = p_city
        and (r.started_at at time zone c.timezone)::date = (now() at time zone c.timezone)::date
    ), 0)
    +
    coalesce((
      select sum(p.ai_cost_usd)
      from public.photo_checks p, public.cities c
      where c.slug = p_city
        and (p.at at time zone c.timezone)::date = (now() at time zone c.timezone)::date
    ), 0);
$fn$;

comment on function public.admin_ai_spend_today(text) is
  'Every dollar of AI spend today in this city, across every job: the nightly import, the community liveness check and the photo check. A job whose spend is missing from here turns a hard cap into a suggestion.';

-- ---------------------------------------------------------------------------
-- Recording a check. Service key only: the Worker calls it, never a visitor.
-- ---------------------------------------------------------------------------
--
-- **The stale-photo rule, borrowed from `admin_set_photo_status`.** Between the upload
-- and the answer the person may have replaced the photo, which sends the row back to
-- pending. A check that comes back about a file the person no longer has is still
-- recorded — it was real and it cost money — but it moves nothing. The same applies
-- when a human has already decided: an automated check never overrules a person.
create function public.admin_record_photo_check(
  p_person       uuid,
  p_photo_path   text,
  p_outcome      text,
  p_source       text,
  p_reason       text default null,
  p_model        text default null,
  p_cost         numeric default 0,
  p_duration_ms  integer default null,
  p_error        text default null
) returns public.photo_status
language plpgsql set search_path = '' as $fn$
declare
  applied public.photo_status;
begin
  insert into public.photo_checks
    (person_id, photo_path, outcome, source, reason, model, ai_cost_usd, duration_ms, error)
  values
    (p_person, p_photo_path, p_outcome, p_source, p_reason, p_model, coalesce(p_cost, 0), p_duration_ms, p_error);

  -- A failed attempt decides nothing. The photo stays pending and the row above is
  -- the only trace — which is the whole point of the row.
  if p_outcome = 'failed' or p_person is null then
    return null;
  end if;

  update public.people
  set photo_status = p_outcome::public.photo_status
  where id = p_person
    and photo_path = p_photo_path
    and photo_status = 'pending'
  returning photo_status into applied;

  -- Only a check that actually moved something is a moderation decision.
  if applied is not null then
    insert into public.moderation_log (actor, action, person_id, note)
    values ('ai:photo-check', 'photo_' || p_outcome, p_person, left(coalesce(p_reason, p_photo_path), 500));
  end if;
  return applied;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- What the admin shows, so the three states are never one number.
-- ---------------------------------------------------------------------------
create function public.admin_photo_states()
returns table (waiting_for_human bigint, never_checked bigint, check_failing bigint)
language sql stable set search_path = '' as $fn$
  with tried as (
    select p.id, p.photo_status,
           count(c.id) filter (where c.photo_path = p.photo_path) as attempts
    from public.people p
    left join public.photo_checks c on c.person_id = p.id
    where p.photo_path is not null
    group by p.id, p.photo_status
  )
  select
    count(*) filter (where photo_status = 'needs_review'),
    count(*) filter (where photo_status = 'pending' and attempts = 0),
    count(*) filter (where photo_status = 'pending' and attempts > 0)
  from tried;
$fn$;

comment on function public.admin_photo_states() is
  'Three counts that must never be one: a photo the check could not decide, a photo nothing has looked at yet, and a photo every attempt has failed on.';

-- The admin decides; it never leaves a photo undecided. `pending` was already
-- refused; `needs_review` is refused for the same reason — it is what the human was
-- asked to resolve.
create or replace function public.admin_set_photo_status(
  p_person uuid, p_photo_path text, p_status public.photo_status, p_actor text
) returns void
language plpgsql set search_path = '' as $fn$
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Choose approved or rejected';
  end if;
  update public.people set photo_status = p_status
  where id = p_person and photo_path = p_photo_path;
  if not found then raise exception 'The photo has changed since you opened this page. Reload.'; end if;
  insert into public.moderation_log (actor, action, person_id, note)
  values (p_actor, 'photo_' || p_status::text, p_person, p_photo_path);
end;
$fn$;

revoke execute on function
  public.admin_record_photo_check(uuid, text, text, text, text, text, numeric, integer, text),
  public.admin_photo_states()
from public, anon, authenticated;

grant execute on function
  public.admin_record_photo_check(uuid, text, text, text, text, text, numeric, integer, text),
  public.admin_photo_states()
to service_role;
