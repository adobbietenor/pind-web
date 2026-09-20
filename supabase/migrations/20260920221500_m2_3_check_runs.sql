-- M2.3b — the liveness check's own run record, and one answer to "what have we spent
-- today" (Alex: "own cron, own budget line, never inside the import").
--
-- **Why a second table rather than reusing import_runs.** Two reasons, both structural:
--   * `admin_start_import_run` refuses to start while any run is 'running' — one global
--     lock, deliberately, so two Ticketmaster imports cannot race. A liveness run in
--     that table would block "Run import now" and be blocked by it, and the error
--     Alex would see is "An import is already running", which would be true and
--     useless.
--   * `import_runs.source` is a `gathering_source`, and this job imports nothing.
--     Calling it 'ai' to fit the column would overload a value that already means the
--     discovery run.
--
-- **And why the spend query has to cover both.** `admin_ai_spend_today` sums
-- `import_runs`, so **any AI spend outside that table is invisible to the daily cap** —
-- which is M1.3b's recorded cost blind spot, one table over. A second job with its own
-- budget and no place in the cap's arithmetic is how a $3 cap becomes a $6 day. So the
-- function is replaced to sum both, and the cap keeps meaning what it says.
--
-- No visibility change: service key only, like every other operational record (V12).

create table public.community_check_runs (
  id           bigint generated always as identity primary key,
  trigger      text not null check (trigger in ('cron', 'manual')),
  actor        text not null check (actor <> ''),
  city         text not null references public.cities (slug) on delete restrict,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  counts       jsonb not null default '{}',
  ai_cost_usd  numeric(10, 6) not null default 0 check (ai_cost_usd >= 0),
  error        text
);

comment on table public.community_check_runs is
  'One row per liveness run: which series it read, what they said, what it cost. A failed run leaves a failed row behind — the rule that M2.2 was built out of.';

create index community_check_runs_started_idx on public.community_check_runs (started_at desc);

alter table public.community_check_runs enable row level security;
revoke all on public.community_check_runs from anon, authenticated;

-- One at a time, with its own lock and its own abandoned sweep, exactly like the
-- import's — and a lock of its own so the two jobs cannot block each other.
create function public.admin_start_check_run(p_trigger text, p_actor text, p_city text)
returns bigint
language plpgsql set search_path = '' as $$
declare
  run_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('pind:community_check_runs'));
  update public.community_check_runs
  set status = 'failed', finished_at = now(), error = 'Abandoned: did not finish'
  where status = 'running' and started_at < now() - interval '20 minutes';
  if exists (select 1 from public.community_check_runs where status = 'running') then
    raise exception 'A liveness run is already going';
  end if;
  insert into public.community_check_runs (trigger, actor, city)
  values (p_trigger, p_actor, p_city)
  returning id into run_id;
  return run_id;
end;
$$;

revoke execute on function public.admin_start_check_run(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_start_check_run(text, text, text) to service_role;

-- Today's AI spend, across every job that spends it. Rebuilt from the definition in
-- 20260918192103_m1_3_import_functions, which is the only migration that has ever
-- defined it.
create or replace function public.admin_ai_spend_today(p_city text) returns numeric
language sql stable set search_path = '' as $$
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
    ), 0);
$$;

comment on function public.admin_ai_spend_today(text) is
  'Every dollar of AI spend today in this city, across every job. A job whose spend is missing from here turns a hard cap into a suggestion.';
