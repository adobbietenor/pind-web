-- Phase 1 M1.2 — gathering lifecycle rules and admin actions (decisions.md Part 5).
--
-- The rules are a trigger on gatherings, so they hold for every writer, the service
-- key included (it bypasses RLS, not triggers):
--   - becoming published needs a venue with 3 approved (active) meeting spots;
--   - unpublishing needs zero pins;
--   - a published gathering's venue cannot change;
--   - a merged gathering cannot be restored.
--
-- Each admin action is one function, so everything it changes happens together or
-- not at all, and it writes the moderation log in the same transaction. They are
-- callable by service_role only (the admin Worker); anon and authenticated cannot
-- execute them. They run as the caller (service_role bypasses RLS).
--
-- Lifecycle:  (import / manual) → draft → published → draft (unpublish, zero pins)
--             draft → dismissed → draft (restore)
--             draft → dismissed + merged_into (merge; never restored)

-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------

create function private.gathering_status_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then
    if new.venue_id is null then
      raise exception 'Cannot publish: the gathering has no venue' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.meeting_spots s where s.venue_id = new.venue_id and s.active) < 3 then
      raise exception 'Cannot publish: the venue needs 3 approved meeting spots' using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.published_at is not null and new.published_at is null
       and exists (select 1 from public.pins p where p.gathering_id = old.id) then
      raise exception 'Cannot unpublish: people have pinned in' using errcode = 'check_violation';
    end if;
    if old.published_at is not null and new.published_at is not null
       and new.venue_id is distinct from old.venue_id then
      raise exception 'Cannot change the venue of a published gathering' using errcode = 'check_violation';
    end if;
    if old.merged_into_id is not null and new.dismissed_at is null then
      raise exception 'Cannot restore a merged gathering' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.gathering_status_rules() from public;

create trigger gatherings_status_rules
  before insert or update of published_at, dismissed_at, venue_id on public.gatherings
  for each row execute function private.gathering_status_rules();

-- ---------------------------------------------------------------------------
-- Gathering actions
-- ---------------------------------------------------------------------------

-- Publish a draft. Builds the spot poll: keeps options already chosen at this venue,
-- tops up from the venue's spots in order, each at start minus 60 minutes.
create function public.admin_publish_gathering(p_gathering uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  g public.gatherings;
begin
  select * into g from public.gatherings where id = p_gathering for update;
  if not found then raise exception 'Gathering not found'; end if;
  if g.published_at is not null then raise exception 'Already published'; end if;
  if g.dismissed_at is not null then raise exception 'Dismissed: restore it first'; end if;
  if g.starts_at <= now() then raise exception 'Cannot publish: it has already started'; end if;
  if g.venue_id is null then raise exception 'Cannot publish: the gathering has no venue'; end if;
  if (select count(*) from public.meeting_spots s where s.venue_id = g.venue_id and s.active) < 3 then
    raise exception 'Cannot publish: the venue needs 3 approved meeting spots';
  end if;

  -- Options left over from a different venue, or a spot since deactivated.
  delete from public.gathering_spots gs
  using public.meeting_spots s
  where gs.gathering_id = p_gathering
    and s.id = gs.spot_id
    and (s.venue_id <> g.venue_id or not s.active);

  insert into public.gathering_spots (gathering_id, spot_id, meet_at)
  select p_gathering, s.id, g.starts_at - interval '60 minutes'
  from public.meeting_spots s
  where s.venue_id = g.venue_id
    and s.active
    and not exists (
      select 1 from public.gathering_spots gs where gs.gathering_id = p_gathering and gs.spot_id = s.id
    )
  order by s.sort_order, s.created_at
  limit greatest(0, 3 - (select count(*) from public.gathering_spots gs where gs.gathering_id = p_gathering));

  if (select count(*) from public.gathering_spots gs where gs.gathering_id = p_gathering) <> 3 then
    raise exception 'Cannot publish: the spot poll needs exactly 3 spots';
  end if;

  update public.gatherings set published_at = now() where id = p_gathering;
  insert into public.moderation_log (actor, action, gathering_id) values (p_actor, 'publish', p_gathering);
end;
$$;

-- Back to draft. The trigger refuses if anyone has pinned in.
create function public.admin_unpublish_gathering(p_gathering uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.gatherings set published_at = null
  where id = p_gathering and published_at is not null;
  if not found then raise exception 'Not a published gathering'; end if;
  insert into public.moderation_log (actor, action, gathering_id) values (p_actor, 'unpublish', p_gathering);
end;
$$;

create function public.admin_dismiss_gathering(p_gathering uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.gatherings set dismissed_at = now()
  where id = p_gathering and published_at is null and dismissed_at is null;
  if not found then raise exception 'Only a draft can be dismissed'; end if;
  insert into public.moderation_log (actor, action, gathering_id) values (p_actor, 'dismiss', p_gathering);
end;
$$;

create function public.admin_restore_gathering(p_gathering uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.gatherings set dismissed_at = null
  where id = p_gathering and dismissed_at is not null and merged_into_id is null;
  if not found then raise exception 'Only a dismissed, unmerged gathering can be restored'; end if;
  insert into public.moderation_log (actor, action, gathering_id) values (p_actor, 'restore', p_gathering);
end;
$$;

-- Merge a duplicate draft into another gathering (draft or published). The loser's
-- source records move to the survivor, so future imports land on the survivor; the
-- survivor keeps its own fields and only fills blanks from the loser.
create function public.admin_merge_gatherings(p_loser uuid, p_survivor uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  l public.gatherings;
  s public.gatherings;
begin
  if p_loser = p_survivor then raise exception 'Cannot merge a gathering into itself'; end if;
  perform 1 from public.gatherings where id in (p_loser, p_survivor) order by id for update;
  select * into l from public.gatherings where id = p_loser;
  if not found then raise exception 'Gathering not found'; end if;
  select * into s from public.gatherings where id = p_survivor;
  if not found then raise exception 'Gathering not found'; end if;
  if l.published_at is not null or l.dismissed_at is not null then
    raise exception 'Only a draft can be merged into another gathering';
  end if;
  if s.dismissed_at is not null then raise exception 'Cannot merge into a dismissed gathering'; end if;

  update public.gathering_sources set gathering_id = p_survivor where gathering_id = p_loser;

  update public.gatherings
  set event_url      = coalesce(event_url, l.event_url),
      venue_name_raw = coalesce(venue_name_raw, l.venue_name_raw),
      venue_id       = coalesce(venue_id, l.venue_id)
  where id = p_survivor;

  insert into public.gathering_triage (gathering_id, score, reason, scored_at)
  select p_survivor, t.score, t.reason, t.scored_at from public.gathering_triage t where t.gathering_id = p_loser
  on conflict (gathering_id) do nothing;

  update public.gatherings set dismissed_at = now(), merged_into_id = p_survivor where id = p_loser;
  insert into public.moderation_log (actor, action, gathering_id, note)
  values (p_actor, 'merge', p_loser, 'into ' || p_survivor::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation actions
-- ---------------------------------------------------------------------------

-- Approve or reject a photo — only the exact photo the admin looked at. If the person
-- has changed it since, nothing happens and the admin reloads.
create function public.admin_set_photo_status(
  p_person uuid, p_photo_path text, p_status public.photo_status, p_actor text
) returns void
language plpgsql set search_path = '' as $$
begin
  if p_status = 'pending' then raise exception 'Choose approved or rejected'; end if;
  update public.people set photo_status = p_status
  where id = p_person and photo_path = p_photo_path;
  if not found then raise exception 'The photo has changed since you opened this page. Reload.'; end if;
  insert into public.moderation_log (actor, action, person_id, note)
  values (p_actor, 'photo_' || p_status::text, p_person, p_photo_path);
end;
$$;

-- Unhide: the reports against them are dismissed. A new report starts the count again.
create function public.admin_unhide_person(p_person uuid, p_actor text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
begin
  update public.people set hidden_at = null where id = p_person and hidden_at is not null;
  if not found then raise exception 'That person is not hidden'; end if;
  update public.reports set status = 'dismissed', reviewed_at = now(), decision_note = p_note
  where target_person_id = p_person and status in ('open', 'auto_hidden');
  insert into public.moderation_log (actor, action, person_id, note) values (p_actor, 'unhide', p_person, p_note);
end;
$$;

-- Keep hidden: the reports are upheld (actioned).
create function public.admin_keep_hidden(p_person uuid, p_actor text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.people where id = p_person and hidden_at is not null) then
    raise exception 'That person is not hidden';
  end if;
  update public.reports set status = 'actioned', reviewed_at = now(), decision_note = p_note
  where target_person_id = p_person and status in ('open', 'auto_hidden');
  insert into public.moderation_log (actor, action, person_id, note) values (p_actor, 'keep_hidden', p_person, p_note);
end;
$$;

-- Hide now: for reports that did not auto-hide (Alex, M1.2).
create function public.admin_hide_person(p_person uuid, p_actor text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
begin
  update public.people set hidden_at = now() where id = p_person and hidden_at is null;
  if not found then raise exception 'That person is already hidden or does not exist'; end if;
  update public.reports set status = 'actioned', reviewed_at = now(), decision_note = p_note
  where target_person_id = p_person and status in ('open', 'auto_hidden');
  insert into public.moderation_log (actor, action, person_id, note) values (p_actor, 'hide', p_person, p_note);
end;
$$;

-- Dismiss open reports on someone who is not hidden.
create function public.admin_dismiss_reports(p_person uuid, p_actor text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.people where id = p_person and hidden_at is not null) then
    raise exception 'That person is hidden: use Unhide or Keep hidden';
  end if;
  update public.reports set status = 'dismissed', reviewed_at = now(), decision_note = p_note
  where target_person_id = p_person and status = 'open';
  if not found then raise exception 'No open reports on that person'; end if;
  insert into public.moderation_log (actor, action, person_id, note) values (p_actor, 'dismiss_reports', p_person, p_note);
end;
$$;

-- Delete a pin on request. Its +1s go with it (cascade), and so does its spot vote.
-- The person row stays: they may be pinned elsewhere.
create function public.admin_delete_pin(p_pin uuid, p_actor text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
declare
  pin public.pins;
begin
  select * into pin from public.pins where id = p_pin for update;
  if not found then raise exception 'Pin not found'; end if;
  delete from public.spot_votes where gathering_id = pin.gathering_id and person_id = pin.person_id;
  delete from public.pins where id = p_pin;
  insert into public.moderation_log (actor, action, gathering_id, person_id, pin_id, note)
  values (p_actor, 'pin_delete', pin.gathering_id, pin.person_id, p_pin, p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Spot suggestions
-- ---------------------------------------------------------------------------

-- Approve, optionally edited. Creates the real meeting spot at the end of the
-- venue's list. Returns its id.
create function public.admin_approve_spot(
  p_suggestion uuid, p_name text, p_description text, p_actor text
) returns uuid
language plpgsql set search_path = '' as $$
declare
  s public.spot_suggestions;
  spot uuid;
begin
  select * into s from public.spot_suggestions where id = p_suggestion for update;
  if not found or s.status <> 'pending' then raise exception 'Not a pending suggestion'; end if;

  insert into public.meeting_spots (venue_id, name, description, sort_order)
  values (
    s.venue_id,
    coalesce(nullif(btrim(p_name), ''), s.name),
    coalesce(nullif(btrim(p_description), ''), s.description),
    coalesce((select max(m.sort_order) + 1 from public.meeting_spots m where m.venue_id = s.venue_id), 0)
  )
  returning id into spot;

  update public.spot_suggestions set status = 'approved', decided_at = now(), meeting_spot_id = spot
  where id = p_suggestion;
  insert into public.moderation_log (actor, action, venue_id, note)
  values (p_actor, 'spot_approve', s.venue_id, coalesce(nullif(btrim(p_name), ''), s.name));
  return spot;
end;
$$;

create function public.admin_reject_spot(p_suggestion uuid, p_actor text) returns void
language plpgsql set search_path = '' as $$
declare
  s public.spot_suggestions;
begin
  update public.spot_suggestions set status = 'rejected', decided_at = now()
  where id = p_suggestion and status = 'pending'
  returning * into s;
  if not found then raise exception 'Not a pending suggestion'; end if;
  insert into public.moderation_log (actor, action, venue_id, note) values (p_actor, 'spot_reject', s.venue_id, s.name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service key only. Supabase grants execute on new functions to anon and
-- authenticated by default, so revoke explicitly.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.admin_publish_gathering(uuid, text),
  public.admin_unpublish_gathering(uuid, text),
  public.admin_dismiss_gathering(uuid, text),
  public.admin_restore_gathering(uuid, text),
  public.admin_merge_gatherings(uuid, uuid, text),
  public.admin_set_photo_status(uuid, text, public.photo_status, text),
  public.admin_unhide_person(uuid, text, text),
  public.admin_keep_hidden(uuid, text, text),
  public.admin_hide_person(uuid, text, text),
  public.admin_dismiss_reports(uuid, text, text),
  public.admin_delete_pin(uuid, text, text),
  public.admin_approve_spot(uuid, text, text, text),
  public.admin_reject_spot(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.admin_publish_gathering(uuid, text),
  public.admin_unpublish_gathering(uuid, text),
  public.admin_dismiss_gathering(uuid, text),
  public.admin_restore_gathering(uuid, text),
  public.admin_merge_gatherings(uuid, uuid, text),
  public.admin_set_photo_status(uuid, text, public.photo_status, text),
  public.admin_unhide_person(uuid, text, text),
  public.admin_keep_hidden(uuid, text, text),
  public.admin_hide_person(uuid, text, text),
  public.admin_dismiss_reports(uuid, text, text),
  public.admin_delete_pin(uuid, text, text),
  public.admin_approve_spot(uuid, text, text, text),
  public.admin_reject_spot(uuid, text)
to service_role;
