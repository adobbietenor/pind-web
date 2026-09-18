-- Phase 1 M1.3 — import and admin functions (decisions.md Part 5).
--
-- Service key only, like every admin_* function: anon and authenticated cannot execute
-- them. They run as the caller (service_role bypasses RLS, not triggers), so the M1.2
-- publishing rules still hold.
--
-- The importer's rights, enforced HERE and not only in the Worker:
--   - it may create drafts and venues, refresh source rows, move a draft's date,
--     dismiss a draft, and restore a draft that it dismissed itself;
--   - it never changes a published or withdrawn gathering — it can only raise a flag;
--   - it never restores a draft Alex dismissed or merged.
-- The importer's moderation_log actor is 'importer:ticketmaster'; Alex's is the email.

-- ---------------------------------------------------------------------------
-- Runs: one at a time, and the day's AI spend
-- ---------------------------------------------------------------------------

-- Starts a run, or refuses while another is running. A run still "running" after
-- 20 minutes died without finishing (a Worker is stopped at 15) and is closed as failed.
create function public.admin_start_import_run(
  p_source public.gathering_source, p_trigger text, p_actor text, p_city text
) returns bigint
language plpgsql set search_path = '' as $$
declare
  run_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('pind:import_runs'));
  update public.import_runs
  set status = 'failed', finished_at = now(), error = 'Abandoned: did not finish'
  where status = 'running' and started_at < now() - interval '20 minutes';
  if exists (select 1 from public.import_runs where status = 'running') then
    raise exception 'An import is already running';
  end if;
  insert into public.import_runs (source, trigger, actor, city)
  values (p_source, p_trigger, p_actor, p_city)
  returning id into run_id;
  return run_id;
end;
$$;

-- AI spend today, all runs, by the city's calendar day (decisions: $3 per Toronto day).
create function public.admin_ai_spend_today(p_city text) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(r.ai_cost_usd), 0)
  from public.import_runs r, public.cities c
  where c.slug = p_city
    and (r.started_at at time zone c.timezone)::date = (now() at time zone c.timezone)::date;
$$;

-- ---------------------------------------------------------------------------
-- Apply one night's plan (built by src/import/ticketmaster.ts planImport) in one
-- transaction. Every step re-checks the gathering's state, so a plan can never change
-- a published gathering or bring back a draft Alex dismissed.
-- ---------------------------------------------------------------------------

create function public.admin_import_apply(p_run bigint, p_plan jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  c_actor constant text := 'importer:ticketmaster';
  v_city text;
  new_venue_ids jsonb := '{}';
  nv record;
  d jsonb;
  s jsonb;
  u record;
  r record;
  f record;
  gid uuid;
  vid uuid;
  last_actor text;
  last_action text;
  n_venues int := 0;
  n_new int := 0;
  n_attached int := 0;
  n_seen int := 0;
  n_missing int := 0;
  n_updated int := 0;
  n_dismissed int := 0;
  n_restored int := 0;
  n_flagged int := 0;
  n int;
begin
  select city into v_city from public.import_runs where id = p_run and status = 'running';
  if not found then raise exception 'Not a running import'; end if;

  -- New venues, with coordinates, marked for Alex to confirm.
  for nv in
    select * from jsonb_to_recordset(coalesce(p_plan -> 'newVenues', '[]'))
      as x(key text, name text, address text, lat double precision, lng double precision, "externalIds" jsonb)
  loop
    select e.venue_id into vid
    from public.venue_external_ids e
    where e.source = 'ticketmaster'
      and e.external_id in (select jsonb_array_elements_text(nv."externalIds"))
    limit 1;
    if vid is null then
      insert into public.venues (name, address, latitude, longitude, city)
      values (
        btrim(nv.name),
        nullif(btrim(nv.address), ''),
        case when nv.lat is not null and nv.lng is not null then nv.lat end,
        case when nv.lat is not null and nv.lng is not null then nv.lng end,
        v_city
      )
      returning id into vid;
      n_venues := n_venues + 1;
    end if;
    insert into public.venue_external_ids (source, external_id, venue_id, needs_review)
    select 'ticketmaster', x, vid, true from jsonb_array_elements_text(nv."externalIds") x
    on conflict (source, external_id) do nothing;
    new_venue_ids := new_venue_ids || jsonb_build_object(nv.key, vid);
    vid := null;
  end loop;

  -- Ticketmaster venue ids learned by matching a name or alias.
  insert into public.venue_external_ids (source, external_id, venue_id)
  select 'ticketmaster', x."externalId", x."venueId"
  from jsonb_to_recordset(coalesce(p_plan -> 'venueExternalIds', '[]')) as x("externalId" text, "venueId" uuid)
  on conflict (source, external_id) do nothing;

  -- New drafts, each with every Ticketmaster id found for it.
  for d in select * from jsonb_array_elements(coalesce(p_plan -> 'newDrafts', '[]'))
  loop
    if exists (
      select 1 from public.gathering_sources gs
      where gs.source = 'ticketmaster'
        and gs.external_id in (select x ->> 'externalId' from jsonb_array_elements(d -> 'sources') x)
    ) then
      continue; -- already known: never a second copy
    end if;
    insert into public.gatherings (name, starts_at, venue_id, event_url, venue_name_raw, source)
    values (
      d ->> 'name',
      (d ->> 'startsAt')::timestamptz,
      coalesce((d ->> 'venueId')::uuid, (new_venue_ids ->> (d ->> 'newVenue'))::uuid),
      d ->> 'eventUrl',
      d ->> 'venueNameRaw',
      'ticketmaster'
    )
    returning id into gid;
    for s in select * from jsonb_array_elements(d -> 'sources')
    loop
      insert into public.gathering_sources (gathering_id, source, external_id, urls, snapshot)
      values (
        gid, 'ticketmaster', s ->> 'externalId',
        case when s ->> 'url' is null then '{}'::text[] else array[s ->> 'url'] end,
        s -> 'snapshot'
      );
    end loop;
    n_new := n_new + 1;
  end loop;

  -- A new Ticketmaster id for a gathering we already have.
  insert into public.gathering_sources (gathering_id, source, external_id, urls, snapshot)
  select x."gatheringId", 'ticketmaster', x."externalId",
         case when x.url is null then '{}'::text[] else array[x.url] end, x.snapshot
  from jsonb_to_recordset(coalesce(p_plan -> 'attach', '[]'))
    as x("gatheringId" uuid, "externalId" text, url text, snapshot jsonb)
  on conflict (source, external_id) where external_id is not null do nothing;
  get diagnostics n_attached = row_count;

  -- Listings seen again: refresh their facts, no longer missing.
  update public.gathering_sources gs
  set snapshot = x.snapshot,
      last_seen_at = now(),
      missing_since = null,
      urls = case when x.url is null then gs.urls else array[x.url] end
  from jsonb_to_recordset(coalesce(p_plan -> 'seen', '[]')) as x("externalId" text, url text, snapshot jsonb)
  where gs.source = 'ticketmaster' and gs.external_id = x."externalId";
  get diagnostics n_seen = row_count;

  -- Listings gone tonight for the first time.
  update public.gathering_sources gs
  set missing_since = now()
  where gs.source = 'ticketmaster'
    and gs.missing_since is null
    and gs.external_id in (select jsonb_array_elements_text(coalesce(p_plan -> 'missing', '[]')));
  get diagnostics n_missing = row_count;

  -- Drafts only: a moved date, or a venue found at last.
  for u in
    select * from jsonb_to_recordset(coalesce(p_plan -> 'draftUpdates', '[]'))
      as x("gatheringId" uuid, "startsAt" timestamptz, "venueId" uuid, "newVenue" text)
  loop
    update public.gatherings g
    set starts_at = coalesce(u."startsAt", g.starts_at),
        venue_id = coalesce(g.venue_id, u."venueId", (new_venue_ids ->> u."newVenue")::uuid)
    where g.id = u."gatheringId" and g.published_at is null and g.dismissed_at is null;
    get diagnostics n = row_count;
    n_updated := n_updated + n;
  end loop;

  -- Drafts only: dismissed quietly, logged as the importer.
  for r in
    select * from jsonb_to_recordset(coalesce(p_plan -> 'dismiss', '[]')) as x("gatheringId" uuid, reason text)
  loop
    update public.gatherings g
    set dismissed_at = now()
    where g.id = r."gatheringId" and g.published_at is null and g.dismissed_at is null;
    if found then
      insert into public.moderation_log (actor, action, gathering_id, note)
      values (c_actor, 'dismiss', r."gatheringId", 'Ticketmaster: ' || r.reason);
      n_dismissed := n_dismissed + 1;
    end if;
  end loop;

  -- Restore a draft only if the importer dismissed it last. Alex's dismissals, and
  -- merges, stay.
  for r in
    select * from jsonb_to_recordset(coalesce(p_plan -> 'restore', '[]')) as x("gatheringId" uuid, "startsAt" timestamptz)
  loop
    select l.actor, l.action into last_actor, last_action
    from public.moderation_log l
    where l.gathering_id = r."gatheringId" and l.action in ('dismiss', 'restore', 'merge')
    order by l.at desc, l.id desc
    limit 1;
    if last_actor = c_actor and last_action = 'dismiss' then
      update public.gatherings g
      set dismissed_at = null, starts_at = r."startsAt"
      where g.id = r."gatheringId" and g.dismissed_at is not null and g.merged_into_id is null;
      if found then
        insert into public.moderation_log (actor, action, gathering_id, note)
        values (c_actor, 'restore', r."gatheringId", 'Ticketmaster lists it again');
        n_restored := n_restored + 1;
      end if;
    end if;
  end loop;

  -- Published and live only: a flag for Alex. One open flag per gathering per kind;
  -- a newer change updates it.
  for f in
    select * from jsonb_to_recordset(coalesce(p_plan -> 'flags', '[]'))
      as x("gatheringId" uuid, kind public.gathering_flag_kind, "oldStartsAt" timestamptz, "newStartsAt" timestamptz, status text)
  loop
    if exists (
      select 1 from public.gatherings g
      where g.id = f."gatheringId" and g.published_at is not null and g.withdrawn_at is null
    ) then
      insert into public.gathering_flags (gathering_id, kind, source, old_starts_at, new_starts_at, status)
      values (f."gatheringId", f.kind, 'ticketmaster', f."oldStartsAt", f."newStartsAt", f.status)
      on conflict (gathering_id, kind) where resolved_at is null
      do update set new_starts_at = excluded.new_starts_at, status = excluded.status, updated_at = now();
      n_flagged := n_flagged + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'venues_created', n_venues, 'new', n_new, 'attached', n_attached, 'seen', n_seen,
    'missing', n_missing, 'updated', n_updated, 'dismissed', n_dismissed,
    'restored', n_restored, 'flagged', n_flagged
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention (decisions Part 5): 30 days after a gathering's effective end, delete what
-- is Ticketmaster's — their ids, links and facts. Drafts and dismissed gatherings that
-- only Ticketmaster ever supplied were never ours and go entirely. Published
-- gatherings stay as our own minimal record (name, date, venue, counts).
-- Venue ids are kept: they describe a building, not an event, and matching needs them.
-- ---------------------------------------------------------------------------

create function public.admin_purge_ticketmaster_data(p_days integer default 30) returns jsonb
language plpgsql set search_path = '' as $$
declare
  n_deleted int;
  n_sources int;
  n_links int;
begin
  delete from public.gatherings g
  where g.published_at is null
    and g.source = 'ticketmaster'
    and public.effective_end(g) < now() - make_interval(days => p_days)
    and not exists (
      select 1 from public.gathering_sources gs where gs.gathering_id = g.id and gs.source <> 'ticketmaster'
    )
    and not exists (select 1 from public.pins p where p.gathering_id = g.id);
  get diagnostics n_deleted = row_count;

  delete from public.gathering_sources gs
  using public.gatherings g
  where gs.gathering_id = g.id
    and gs.source = 'ticketmaster'
    and public.effective_end(g) < now() - make_interval(days => p_days);
  get diagnostics n_sources = row_count;

  update public.gatherings g
  set event_url = null
  where g.event_url ~* '^https://([a-z0-9-]+\.)*ticketmaster\.[a-z.]+(/|$)'
    and public.effective_end(g) < now() - make_interval(days => p_days);
  get diagnostics n_links = row_count;

  return jsonb_build_object('gatherings_deleted', n_deleted, 'sources_deleted', n_sources, 'links_cleared', n_links);
end;
$$;

-- ---------------------------------------------------------------------------
-- Withdrawn (Alex, M1.3). Visibility effects are in the previous migration.
-- ---------------------------------------------------------------------------

create function public.admin_withdraw_gathering(
  p_gathering uuid, p_reason public.withdraw_reason, p_note text, p_actor text
) returns void
language plpgsql set search_path = '' as $$
begin
  update public.gatherings set withdrawn_at = now()
  where id = p_gathering and published_at is not null and withdrawn_at is null;
  if not found then raise exception 'Only a published gathering can be withdrawn'; end if;
  insert into public.gathering_withdrawals (gathering_id, reason, note, withdrawn_by)
  values (p_gathering, p_reason, nullif(btrim(p_note), ''), p_actor)
  on conflict (gathering_id) do update
    set reason = excluded.reason, note = excluded.note, withdrawn_by = excluded.withdrawn_by, withdrawn_at = now();
  update public.gathering_flags
  set resolved_at = now(), resolution = 'withdrawn', resolved_by = p_actor
  where gathering_id = p_gathering and resolved_at is null;
  insert into public.moderation_log (actor, action, gathering_id, note)
  values (p_actor, 'withdraw', p_gathering, p_reason::text || coalesce(': ' || nullif(btrim(p_note), ''), ''));
end;
$$;

create function public.admin_unwithdraw_gathering(p_gathering uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.gatherings set withdrawn_at = null
  where id = p_gathering and withdrawn_at is not null;
  if not found then raise exception 'Not a withdrawn gathering'; end if;
  delete from public.gathering_withdrawals where gathering_id = p_gathering;
  insert into public.moderation_log (actor, action, gathering_id) values (p_actor, 'unwithdraw', p_gathering);
end;
$$;

-- ---------------------------------------------------------------------------
-- Flags: apply the new date, or ignore. (Withdrawing resolves them too.)
-- Applying moves the spot poll times by the same amount.
-- ---------------------------------------------------------------------------

create function public.admin_resolve_flag(p_flag uuid, p_resolution text, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  f public.gathering_flags;
  g public.gatherings;
begin
  select * into f from public.gathering_flags where id = p_flag and resolved_at is null for update;
  if not found then raise exception 'Not an open flag'; end if;
  if p_resolution not in ('applied', 'ignored') then raise exception 'Unknown resolution'; end if;

  if p_resolution = 'applied' then
    if f.new_starts_at is null then raise exception 'This flag has no new date to apply'; end if;
    select * into g from public.gatherings where id = f.gathering_id for update;
    if g.published_at is null or g.withdrawn_at is not null then
      raise exception 'Only a live published gathering can take a new date';
    end if;
    update public.gathering_spots set meet_at = meet_at + (f.new_starts_at - g.starts_at) where gathering_id = g.id;
    update public.gatherings set starts_at = f.new_starts_at where id = g.id;
    insert into public.moderation_log (actor, action, gathering_id, note)
    values (p_actor, 'apply_date', g.id, g.starts_at::text || ' → ' || f.new_starts_at::text);
    -- Any other open date flag on it is settled by the same decision.
    update public.gathering_flags
    set resolved_at = now(), resolution = 'applied', resolved_by = p_actor
    where gathering_id = g.id and resolved_at is null and kind in ('date_changed', 'rescheduled') and id <> p_flag;
  else
    insert into public.moderation_log (actor, action, gathering_id, note)
    values (p_actor, 'flag_ignore', f.gathering_id, f.kind::text);
  end if;

  update public.gathering_flags
  set resolved_at = now(), resolution = p_resolution, resolved_by = p_actor
  where id = p_flag;
end;
$$;

-- ---------------------------------------------------------------------------
-- Venues the importer created: confirm, or "this is actually <venue>" (a rename, or a
-- second Ticketmaster id for a place we have). Merging moves drafts, Ticketmaster ids
-- and aliases, keeps the old name as an alias, and deletes the duplicate. Refused
-- once the duplicate has a published gathering or meeting spots.
-- ---------------------------------------------------------------------------

create function public.admin_confirm_venue(p_venue uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.venue_external_ids set needs_review = false where venue_id = p_venue and needs_review;
  insert into public.moderation_log (actor, action, venue_id) values (p_actor, 'venue_confirm', p_venue);
end;
$$;

create function public.admin_merge_venues(p_from uuid, p_into uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  f public.venues;
  t public.venues;
begin
  if p_from = p_into then raise exception 'Cannot merge a venue into itself'; end if;
  perform 1 from public.venues where id in (p_from, p_into) order by id for update;
  select * into f from public.venues where id = p_from;
  if not found then raise exception 'Venue not found'; end if;
  select * into t from public.venues where id = p_into;
  if not found then raise exception 'Venue not found'; end if;
  if exists (select 1 from public.gatherings g where g.venue_id = p_from and g.published_at is not null) then
    raise exception 'Cannot merge: it has a published gathering';
  end if;
  if exists (select 1 from public.meeting_spots s where s.venue_id = p_from) then
    raise exception 'Cannot merge: it has meeting spots';
  end if;

  update public.gatherings set venue_id = p_into where venue_id = p_from;
  update public.venue_external_ids set venue_id = p_into, needs_review = false where venue_id = p_from;
  update public.venue_aliases a set venue_id = p_into
  where a.venue_id = p_from
    and not exists (select 1 from public.venue_aliases b where b.venue_id = p_into and b.alias_key = a.alias_key);
  insert into public.venue_aliases (venue_id, alias) values (p_into, f.name)
  on conflict (venue_id, alias_key) do nothing;
  update public.venues
  set address = coalesce(address, f.address),
      latitude = case when latitude is null then f.latitude else latitude end,
      longitude = case when latitude is null then f.longitude else longitude end
  where id = p_into;
  delete from public.venues where id = p_from; -- its leftover aliases and suggestions cascade

  insert into public.moderation_log (actor, action, venue_id, note)
  values (p_actor, 'venue_merge', p_into, 'from ' || f.name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service key only.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.admin_start_import_run(public.gathering_source, text, text, text),
  public.admin_ai_spend_today(text),
  public.admin_import_apply(bigint, jsonb),
  public.admin_purge_ticketmaster_data(integer),
  public.admin_withdraw_gathering(uuid, public.withdraw_reason, text, text),
  public.admin_unwithdraw_gathering(uuid, text),
  public.admin_resolve_flag(uuid, text, text),
  public.admin_confirm_venue(uuid, text),
  public.admin_merge_venues(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.admin_start_import_run(public.gathering_source, text, text, text),
  public.admin_ai_spend_today(text),
  public.admin_import_apply(bigint, jsonb),
  public.admin_purge_ticketmaster_data(integer),
  public.admin_withdraw_gathering(uuid, public.withdraw_reason, text, text),
  public.admin_unwithdraw_gathering(uuid, text),
  public.admin_resolve_flag(uuid, text, text),
  public.admin_confirm_venue(uuid, text),
  public.admin_merge_venues(uuid, uuid, text)
to service_role;
