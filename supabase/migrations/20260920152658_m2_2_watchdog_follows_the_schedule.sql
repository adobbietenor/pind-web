-- Phase 2 M2.2 — the watchdog follows the import's schedule instead of a fixed hour
-- (Alex, M2.2).
--
-- The first version ran at 09:00 UTC and called a night missed if no run had started
-- in 26 hours. That embeds an assumption — that the import fires at 08:00 UTC — in a
-- second place, and the two can drift apart silently:
--
--   * if the cron were ever really 08:00 in some local zone, the import would fire at
--     12:00 UTC and the 09:00 watchdog would cry wolf every single day, three hours
--     before the import had a chance to run;
--   * a daylight-saving shift, or someone editing the cron line in wrangler.jsonc,
--     does the same thing more quietly.
--
-- An alerting rule that fires when nothing is wrong is worse than no rule: it trains
-- the reader to ignore it, and then the real missed night looks like all the others.
--
-- So the threshold becomes relative to the schedule, and the schedule becomes a fact
-- the database holds rather than one it assumes:
--
--   1. the cron expression lives in ops_import_schedule, seeded with what
--      wrangler.jsonc says today;
--   2. the Worker overwrites it on every scheduled run with the expression and the
--      real scheduled time Cloudflare fired it with (ScheduledController.cron and
--      .scheduledTime), so the database learns the truth from the only source that
--      cannot be wrong about it;
--   3. the watchdog runs HOURLY and works out for itself whether the import is past
--      due. It cannot overlap the import's schedule, because it has no schedule of
--      its own to overlap with.
--
-- For the record, and not relied upon: Cloudflare cron triggers are always
-- interpreted in UTC. This design means nothing breaks if that is ever wrong.

-- ---------------------------------------------------------------------------
-- 1 · What the schedule is
-- ---------------------------------------------------------------------------

create table public.ops_import_schedule (
  id          boolean primary key default true check (id),
  -- As written in wrangler.jsonc. Only the daily "minute hour * * *" shape is parsed;
  -- anything else falls back to the hour and minute columns, which is why they are
  -- stored rather than derived.
  cron        text not null default '0 8 * * *',
  utc_hour    smallint not null default 8 check (utc_hour between 0 and 23),
  utc_minute  smallint not null default 0 check (utc_minute between 0 and 59),
  -- How long after the due time the run gets before anyone calls it missed. The cron
  -- budget is 15 minutes and a full run has taken 13, so two hours is generous on
  -- purpose: a late alert costs nothing, a false one costs the channel.
  grace_minutes smallint not null default 120 check (grace_minutes between 5 and 1440),
  -- What the Worker last told us, from the invocation itself.
  reported_cron            text,
  reported_scheduled_time  timestamptz,
  reported_at              timestamptz
);

insert into public.ops_import_schedule (id) values (true);

alter table public.ops_import_schedule enable row level security;
revoke all on public.ops_import_schedule from anon, authenticated;

-- The Worker calls this from its scheduled handler. p_cron is
-- ScheduledController.cron and p_scheduled_time is .scheduledTime — the instant
-- Cloudflare meant to fire, which settles the timezone question with evidence rather
-- than with documentation.
create function public.admin_report_import_schedule(p_cron text, p_scheduled_time timestamptz)
returns void
language plpgsql set search_path = '' as $$
declare
  parts text[];
  m     smallint;
  h     smallint;
begin
  update public.ops_import_schedule
  set reported_cron = p_cron, reported_scheduled_time = p_scheduled_time, reported_at = now()
  where id;

  if p_cron is null or btrim(p_cron) = '' then return; end if;
  parts := regexp_split_to_array(btrim(p_cron), '\s+');
  -- Only the plain daily shape is understood. Anything else leaves the stored hour
  -- and minute alone rather than guessing at a schedule nobody can check.
  if array_length(parts, 1) <> 5 or parts[3] <> '*' or parts[4] <> '*' or parts[5] <> '*' then
    return;
  end if;
  if parts[1] !~ '^\d{1,2}$' or parts[2] !~ '^\d{1,2}$' then return; end if;
  m := parts[1]::smallint;
  h := parts[2]::smallint;
  if m > 59 or h > 23 then return; end if;

  update public.ops_import_schedule set cron = btrim(p_cron), utc_minute = m, utc_hour = h where id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 · When the import was last due, and when it stops being merely late
--
-- The most recent occurrence of the scheduled time at or before now, in UTC. The
-- run is "overdue" only once the grace has also passed, so a slow run is never
-- reported as a missing one.
-- ---------------------------------------------------------------------------

create function public.admin_import_due() returns jsonb
language sql stable set search_path = '' as $$
  with s as (select * from public.ops_import_schedule where id),
  today as (
    select s.*,
           date_trunc('day', now() at time zone 'UTC')
             + make_interval(hours => s.utc_hour, mins => s.utc_minute) as todays_slot
    from s
  )
  select jsonb_build_object(
    'cron', t.cron,
    'grace_minutes', t.grace_minutes,
    'reported_cron', t.reported_cron,
    'reported_scheduled_time', t.reported_scheduled_time,
    'due_at', d.due_at,
    'overdue_at', d.due_at + make_interval(mins => t.grace_minutes),
    'past_grace', now() > d.due_at + make_interval(mins => t.grace_minutes)
  )
  from today t
  cross join lateral (
    select (case when (now() at time zone 'UTC') >= t.todays_slot
                 then t.todays_slot else t.todays_slot - interval '1 day' end)
           at time zone 'UTC' as due_at
  ) d;
$$;

-- ---------------------------------------------------------------------------
-- 3 · Health, now measured against the schedule
--
-- "Stale" is no longer "more than 26 hours"; it is "the run that was due has not
-- succeeded, and its grace has run out". One definition, read by the banner, the
-- Configuration panel and the watchdog.
-- ---------------------------------------------------------------------------

create or replace function public.admin_import_health() returns jsonb
language sql stable set search_path = '' as $$
  with due as (select public.admin_import_due() as d),
  last_any as (
    select started_at, status, error from public.import_runs
    where trigger in ('cron', 'manual') order by started_at desc limit 1
  ),
  last_good as (
    select started_at from public.import_runs
    where trigger in ('cron', 'manual') and status in ('ok', 'partial')
    order by started_at desc limit 1
  )
  select jsonb_build_object(
    'last_run_at',      (select started_at from last_any),
    'last_run_status',  (select status from last_any),
    'last_run_error',   (select error from last_any),
    'last_success_at',  (select started_at from last_good),
    'hours_since_success',
      case when (select started_at from last_good) is null then null
           else round(extract(epoch from (now() - (select started_at from last_good))) / 3600.0, 1) end,
    'due_at',        (select d ->> 'due_at' from due),
    'overdue_at',    (select d ->> 'overdue_at' from due),
    'cron',          (select d ->> 'cron' from due),
    'grace_minutes', (select (d ->> 'grace_minutes')::int from due),
    'reported_scheduled_time', (select d ->> 'reported_scheduled_time' from due),
    -- Late is not missed. Only past the grace does a due run that has not succeeded
    -- count as stale.
    'stale',
      (select (d ->> 'past_grace')::boolean from due)
      and coalesce(
        (select started_at from last_good) < (select (d ->> 'due_at')::timestamptz from due),
        true
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 4 · The watchdog, hourly, deciding for itself whether anything is wrong
-- ---------------------------------------------------------------------------

create or replace function public.admin_watchdog_import() returns jsonb
language plpgsql set search_path = '' as $$
declare
  health     jsonb;
  due_at     timestamptz;
  last_start timestamptz;
  city_slug  text;
  run_id     bigint;
begin
  health := public.admin_import_health();
  due_at := (health ->> 'due_at')::timestamptz;

  -- Not yet past the grace: the run may simply be late, or still going.
  if not coalesce((health ->> 'stale')::boolean, false) then
    return jsonb_build_object('missed', false, 'due_at', due_at, 'reason', 'not overdue, or it has succeeded');
  end if;

  select max(started_at) into last_start from public.import_runs where trigger in ('cron', 'manual');

  -- One row per missed slot, not one per hourly check.
  if exists (
    select 1 from public.import_runs
    where trigger = 'watchdog' and started_at >= due_at
  ) then
    return jsonb_build_object('missed', true, 'already_recorded', true, 'due_at', due_at);
  end if;

  select slug into city_slug from public.cities order by slug limit 1;

  insert into public.import_runs (source, trigger, actor, city, status, finished_at, error, counts)
  values (
    'ticketmaster', 'watchdog', 'watchdog:postgres', city_slug, 'failed', now(),
    format(
      'The nightly import did not run. It was due at %s UTC (cron %s) and nothing has succeeded since, so nothing new has arrived and the published list is not refreshing.',
      to_char(due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
      health ->> 'cron'
    ),
    jsonb_build_object('due_at', due_at, 'last_start', last_start, 'health', health)
  )
  returning id into run_id;

  return jsonb_build_object('missed', true, 'run_id', run_id, 'due_at', due_at, 'last_start', last_start);
end;
$$;

-- Hourly. The watchdog no longer has a schedule that can drift out of step with the
-- import's, because the only schedule that decides anything is the import's own.
select cron.unschedule('pind-import-watchdog') where exists (
  select 1 from cron.job where jobname = 'pind-import-watchdog'
);
select cron.schedule('pind-import-watchdog', '7 * * * *', $$select public.admin_watchdog_import()$$);

revoke execute on function
  public.admin_report_import_schedule(text, timestamptz),
  public.admin_import_due()
  from public, anon, authenticated;

grant execute on function
  public.admin_report_import_schedule(text, timestamptz),
  public.admin_import_due()
  to service_role;
