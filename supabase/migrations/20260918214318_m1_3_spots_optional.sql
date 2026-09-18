-- Phase 1 M1.3 (Alex, after the first import) — meeting spots are needed only when
-- crews open, not to publish. Replaces the M1.2 rule "a gathering can be published
-- only when its venue has 3 approved spots" (decisions.md Part 5, "Meeting spots").
--
--   - Publishing needs a venue, but no meeting spots. Every other publishing rule
--     stays: zero pins to unpublish, a published venue never changes, a merged
--     gathering is never restored.
--   - A venue can have any number of approved spots. The spot poll shows up to 3:
--     at publish it takes the venue's first approved spots, in order, up to 3, each
--     at start minus 60 minutes — none if the venue has none yet.
--   - When a spot is approved (or re-activated) later, every upcoming published,
--     live gathering at that venue with fewer than 3 options is topped up. The poll
--     never shrinks: existing options and votes are left alone.
--   - "Crews are open but the venue has no approved spots" is shown to Alex in the
--     admin, worked out when the page loads (no stored state).
--
-- Visibility is unchanged: meeting spots and published spot options were already
-- public; no policy changes here.

-- ---------------------------------------------------------------------------
-- The trigger rules, without the spots check.
-- ---------------------------------------------------------------------------

create or replace function private.gathering_status_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then
    if new.venue_id is null then
      raise exception 'Cannot publish: the gathering has no venue' using errcode = 'check_violation';
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

-- ---------------------------------------------------------------------------
-- Top up a gathering's spot poll to at most 3 options from its venue's approved
-- spots, in the venue's order, each at start minus 60 minutes.
-- ---------------------------------------------------------------------------

create function private.top_up_spot_poll(p_gathering uuid) returns void
language plpgsql set search_path = '' as $$
declare
  g public.gatherings;
begin
  select * into g from public.gatherings where id = p_gathering;
  if not found or g.venue_id is null then return; end if;
  insert into public.gathering_spots (gathering_id, spot_id, meet_at)
  select g.id, s.id, g.starts_at - interval '60 minutes'
  from public.meeting_spots s
  where s.venue_id = g.venue_id
    and s.active
    and not exists (select 1 from public.gathering_spots gs where gs.gathering_id = g.id and gs.spot_id = s.id)
  order by s.sort_order, s.created_at
  limit greatest(0, 3 - (select count(*) from public.gathering_spots gs where gs.gathering_id = g.id));
end;
$$;

revoke execute on function private.top_up_spot_poll(uuid) from public;

-- Publish a draft: no spots needed. Options left over from another venue, or from a
-- spot since deactivated, are removed (the draft has no votes: nobody can vote on a
-- draft), then the poll is topped up to at most 3.
create or replace function public.admin_publish_gathering(p_gathering uuid, p_actor text) returns void
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

  delete from public.gathering_spots gs
  using public.meeting_spots s
  where gs.gathering_id = p_gathering
    and s.id = gs.spot_id
    and (s.venue_id <> g.venue_id or not s.active);

  perform private.top_up_spot_poll(p_gathering);

  update public.gatherings set published_at = now() where id = p_gathering;
  insert into public.moderation_log (actor, action, gathering_id) values (p_actor, 'publish', p_gathering);
end;
$$;

-- A spot approved or re-activated later reaches every upcoming published, live
-- gathering at its venue that has fewer than 3 options.
create function private.meeting_spot_tops_up_polls() returns trigger
language plpgsql set search_path = '' as $$
declare
  gid uuid;
begin
  if not new.active then return new; end if;
  for gid in
    select g.id from public.gatherings g
    where g.venue_id = new.venue_id
      and g.published_at is not null
      and g.withdrawn_at is null
      and g.starts_at > now()
      and (select count(*) from public.gathering_spots gs where gs.gathering_id = g.id) < 3
  loop
    perform private.top_up_spot_poll(gid);
  end loop;
  return new;
end;
$$;

revoke execute on function private.meeting_spot_tops_up_polls() from public;

create trigger meeting_spots_top_up_polls
  after insert or update of active on public.meeting_spots
  for each row execute function private.meeting_spot_tops_up_polls();
