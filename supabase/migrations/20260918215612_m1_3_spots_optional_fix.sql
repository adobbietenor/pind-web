-- Phase 1 M1.3 — fix for 20260918214318_m1_3_spots_optional.
--
-- The poll top-up helper lived in schema `private`, which service_role (the admin and
-- the importer) cannot use, so publishing failed with "permission denied for schema
-- private". It moves to `public.admin_top_up_spot_poll`, executable by service_role
-- only, like every other admin_* function. Behaviour is unchanged.

create function public.admin_top_up_spot_poll(p_gathering uuid) returns void
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

revoke execute on function public.admin_top_up_spot_poll(uuid) from public, anon, authenticated;
grant execute on function public.admin_top_up_spot_poll(uuid) to service_role;

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

  perform public.admin_top_up_spot_poll(p_gathering);

  update public.gatherings set published_at = now() where id = p_gathering;
  insert into public.moderation_log (actor, action, gathering_id) values (p_actor, 'publish', p_gathering);
end;
$$;

create or replace function private.meeting_spot_tops_up_polls() returns trigger
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
    perform public.admin_top_up_spot_poll(gid);
  end loop;
  return new;
end;
$$;

drop function private.top_up_spot_poll(uuid);
