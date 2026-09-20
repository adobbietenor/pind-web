-- Phase 2 M2.2 — the nightly run reports itself, and a run that never happens is
-- still a fact somebody can see (Alex, M2.2, after the import stopped for two nights
-- with nothing saying so).
--
-- The failure that prompted this had two halves, and the second is the serious one:
--
--   1. A missing Ticketmaster key made runImport return before it opened its run row,
--      so a failed night wrote *nothing*. The admin went on showing Friday's run and
--      looked fine. Fixed in src/import/run.ts by opening the row first.
--   2. Nothing watches for a run that never starts. If Cloudflare's cron does not
--      fire at all — the Worker undeployed, the trigger dropped, the account in a bad
--      state — there is no code of ours running to notice. A watchdog inside the
--      Worker cannot report the Worker's own cron being dead.
--
-- So the watchdog lives here, in Postgres, on pg_cron: the one clock in this system
-- that does not depend on Cloudflare at all (CLAUDE.md: "if it is time-driven, it is
-- pg_cron in Postgres"). It writes the missed night into import_runs, where the admin
-- already looks, and the Worker sends the alert from the same row.

-- ---------------------------------------------------------------------------
-- 1 · Alerts: what was sent, and the once-a-day rule
--
-- An alert channel that repeats itself gets muted, and a muted channel is the silent
-- failure again with extra steps. One alert of a kind per Toronto day, enforced here
-- rather than in the Worker so that two runs — or a run and the watchdog — cannot
-- both send.
-- ---------------------------------------------------------------------------

create table public.ops_alerts (
  id       bigint generated always as identity primary key,
  kind     text not null check (kind <> ''),
  subject  text not null check (subject <> ''),
  sent     boolean not null,
  error    text,
  at       timestamptz not null default now(),
  -- The Toronto day it belongs to, so "once a day" means a day Alex would recognise
  -- rather than a UTC one that rolls over at 8pm.
  local_day date not null generated always as (((at at time zone 'America/Toronto')::date)) stored
);

create index ops_alerts_at_idx on public.ops_alerts (at);
-- Only a *sent* alert suppresses the next one: a send that failed must not silence
-- tomorrow's attempt.
create unique index ops_alerts_one_per_kind_per_day on public.ops_alerts (kind, local_day) where sent;

alter table public.ops_alerts enable row level security;
revoke all on public.ops_alerts from anon, authenticated;

create function public.admin_alert_already_sent_today(p_kind text) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.ops_alerts a
    where a.kind = p_kind and a.sent
      and a.local_day = ((now() at time zone 'America/Toronto')::date)
  );
$$;

create function public.admin_record_alert(p_kind text, p_subject text, p_sent boolean, p_error text)
returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.ops_alerts (kind, subject, sent, error)
  values (p_kind, p_subject, p_sent, p_error)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 · How stale is the import?
--
-- One definition, read by the admin banner, the Configuration panel and the
-- watchdog, so they cannot disagree about whether the city's list is refreshing.
-- "Healthy" is a run that finished ok or partial: partial means some of it worked,
-- which still brings gatherings in.
-- ---------------------------------------------------------------------------

create function public.admin_import_health() returns jsonb
language sql stable set search_path = '' as $$
  with last_any as (
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
    -- The cron is nightly, so 26 hours is one missed night with two hours of slack
    -- for a slow run or a daylight-saving shift.
    'stale', coalesce((select started_at from last_good) < now() - interval '26 hours', true)
  );
$$;

-- ---------------------------------------------------------------------------
-- 3 · The watchdog
--
-- Runs an hour after the Worker's 08:00 UTC cron. If no run has even *started* in
-- the last 26 hours, the night was missed, and that gets written into import_runs as
-- a failed run so it appears wherever a failed run appears. It records the fact; the
-- Worker sends the alert next time it runs, and the admin shows it meanwhile.
--
-- It cannot itself email: the Resend key lives in the Worker and stays there
-- (decisions Part 5). What it removes is the case where *nothing at all* records a
-- missed night.
-- ---------------------------------------------------------------------------

create function public.admin_watchdog_import() returns jsonb
language plpgsql set search_path = '' as $$
declare
  last_start timestamptz;
  city_slug  text;
  run_id     bigint;
begin
  select max(started_at) into last_start from public.import_runs where trigger in ('cron', 'manual');
  if last_start is not null and last_start > now() - interval '26 hours' then
    return jsonb_build_object('missed', false, 'last_start', last_start);
  end if;

  -- Do not write a second missed-night row for the same night.
  if exists (
    select 1 from public.import_runs
    where trigger = 'watchdog' and started_at > now() - interval '20 hours'
  ) then
    return jsonb_build_object('missed', true, 'already_recorded', true);
  end if;

  select slug into city_slug from public.cities order by slug limit 1;

  insert into public.import_runs (source, trigger, actor, city, status, finished_at, error, counts)
  values (
    'ticketmaster', 'watchdog', 'watchdog:postgres', city_slug, 'failed', now(),
    'The nightly import did not run. No run has started in over 26 hours, so nothing new has arrived and the published list is not refreshing.',
    jsonb_build_object('missed_since', last_start)
  )
  returning id into run_id;

  return jsonb_build_object('missed', true, 'run_id', run_id, 'last_start', last_start);
end;
$$;

-- 'watchdog' is a new trigger value; the existing check constraint names its three.
alter table public.import_runs drop constraint import_runs_trigger_check;
alter table public.import_runs
  add constraint import_runs_trigger_check check (trigger in ('cron', 'manual', 'suggest', 'watchdog'));

-- pg_cron, enabled here rather than from the dashboard: a schedule I cannot reproduce
-- from this repo is the same problem as a schema I cannot reproduce from it
-- (CLAUDE.md). The extension creates and owns the `cron` schema.
create extension if not exists pg_cron;

-- 09:00 UTC: one hour after the Worker's nightly cron, which gives a slow run time
-- to have started. Unscheduled first, so re-running this file is safe.
select cron.unschedule('pind-import-watchdog') where exists (
  select 1 from cron.job where jobname = 'pind-import-watchdog'
);
select cron.schedule('pind-import-watchdog', '0 9 * * *', $$select public.admin_watchdog_import()$$);

-- ---------------------------------------------------------------------------
-- Service key only, like every other admin_* function.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.admin_alert_already_sent_today(text),
  public.admin_record_alert(text, text, boolean, text),
  public.admin_import_health(),
  public.admin_watchdog_import()
  from public, anon, authenticated;

grant execute on function
  public.admin_alert_already_sent_today(text),
  public.admin_record_alert(text, text, boolean, text),
  public.admin_import_health(),
  public.admin_watchdog_import()
  to service_role;
