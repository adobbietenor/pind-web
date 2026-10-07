-- M3.3 — notifications #2 and #6, recorded at the moment they happen (Alex, 28 Sept 2026;
-- spec A18, six since the room).
--
--   #2 — the room's: once per person per gathering, when there is first someone to
--        talk to. The first person in a room is told when the second arrives; the second
--        arrives to someone and is not told. "We'll tell you the moment someone else
--        does" (A9's promise) is this row, not copy.
--   #6 — room activity, batched: the first message since you last looked, then nothing
--        from that room for an hour. Never per message. Off in one tap.
--
-- Each is a row in `notifications`, written by a trigger on the act itself (a placement,
-- a message) — never reconstructed later. The Worker delivers them every minute: push to
-- a registered phone, email (Resend) otherwise; the row records the channel and any
-- error. Nothing here is readable by a person; they see only their own switches and
-- their own phone registrations.

create type public.notification_kind as enum ('digest', 'room_open', 'plan_status', 'day_of', 'next_morning', 'room_activity');

-- ---------------------------------------------------------------------------
-- A person's switches (A23: the six, toggleable) and phones
-- ---------------------------------------------------------------------------

create table public.notification_settings (
  person_id      uuid primary key references public.people (id) on delete cascade,
  digest         boolean not null default true,
  room_open      boolean not null default true,
  plan_status    boolean not null default true,
  day_of         boolean not null default true,
  next_morning   boolean not null default true,
  room_activity  boolean not null default true,
  updated_at     timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
grant select, insert, update (digest, room_open, plan_status, day_of, next_morning, room_activity) on public.notification_settings to authenticated;
grant insert (person_id) on public.notification_settings to authenticated;
create policy notification_settings_own on public.notification_settings
  for all to authenticated using (person_id = private.me()) with check (person_id = private.me());

-- On unless switched off: no row means every switch is on.
create function private.wants(p_person uuid, p_kind public.notification_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'digest' then s.digest when 'room_open' then s.room_open when 'plan_status' then s.plan_status
      when 'day_of' then s.day_of when 'next_morning' then s.next_morning when 'room_activity' then s.room_activity end
    from public.notification_settings s where s.person_id = p_person
  ), true);
$$;
revoke all on function private.wants(uuid, public.notification_kind) from public;

create table public.device_tokens (
  token         text primary key check (char_length(token) between 10 and 300),
  person_id     uuid not null references public.people (id) on delete cascade,
  platform      text not null check (platform in ('ios', 'android')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
alter table public.device_tokens enable row level security;
create index device_tokens_person_idx on public.device_tokens (person_id);
grant select, delete on public.device_tokens to authenticated;
grant insert (token, person_id, platform) on public.device_tokens to authenticated;
create policy device_tokens_own_read on public.device_tokens
  for select to authenticated using (person_id = private.me());
create policy device_tokens_own_add on public.device_tokens
  for insert to authenticated with check (person_id = private.me());
create policy device_tokens_own_remove on public.device_tokens
  for delete to authenticated using (person_id = private.me());

-- A phone registers with the app's session. A token already held by someone else moves
-- to whoever is signed in on that phone now (one phone, one person).
create function public.register_device(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if v_me is null then raise exception 'refused: no person' using errcode = '42501'; end if;
  insert into public.device_tokens (token, person_id, platform) values (p_token, v_me, p_platform)
  on conflict (token) do update set person_id = v_me, platform = excluded.platform, last_seen_at = now();
end;
$$;
revoke all on function public.register_device(text, text) from public, anon;
grant execute on function public.register_device(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.people (id) on delete cascade,
  kind          public.notification_kind not null,
  gathering_id  uuid references public.gatherings (id) on delete cascade,
  room_id       uuid references public.rooms (id) on delete cascade,
  crew_id       uuid references public.crews (id) on delete cascade,
  title         text not null,
  body          text not null,
  -- Where the tap goes, a path on pind.social (the app on the web; a universal link later).
  path          text not null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  channel       text check (channel in ('push', 'email', 'none')),
  attempts      smallint not null default 0,
  last_error    text
);
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
create index notifications_unsent_idx on public.notifications (created_at) where sent_at is null;
create index notifications_person_room_idx on public.notifications (person_id, room_id, kind, created_at);
-- #2 once per person per gathering.
create unique index notifications_room_open_once on public.notifications (person_id, gathering_id) where kind = 'room_open';

create function private.gathering_name(p_gathering uuid) returns text
language sql stable security definer set search_path = '' as $$
  select g.name from public.gatherings g where g.id = p_gathering;
$$;
revoke all on function private.gathering_name(uuid) from public;

create function private.crowd_path(p_gathering uuid) returns text
language sql stable security definer set search_path = '' as $$
  select '/crowd/' || coalesce(g.slug, g.id::text) from public.gatherings g where g.id = p_gathering;
$$;
revoke all on function private.crowd_path(uuid) from public;

-- #2: when a room reaches its second person, everyone already there who has not been
-- told at this gathering is told, by the newcomer's first name.
create function private.notify_room_open() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_name text;
begin
  if new.left_at is not null or (tg_op = 'UPDATE' and old.left_at is null) then
    return new;
  end if;
  select count(*) into v_count from public.room_members m where m.room_id = new.room_id and m.left_at is null;
  if v_count <> 2 then
    return new;
  end if;
  select p.first_name into v_name from public.people p where p.id = new.person_id;
  insert into public.notifications (person_id, kind, gathering_id, room_id, title, body, path)
  select m.person_id, 'room_open', new.gathering_id, new.room_id,
         private.gathering_name(new.gathering_id),
         v_name || '''s going to ' || private.gathering_name(new.gathering_id) || ' too — say hi',
         private.crowd_path(new.gathering_id)
  from public.room_members m
  join public.people them on them.id = m.person_id
  where m.room_id = new.room_id and m.left_at is null and m.person_id <> new.person_id
    and them.hidden_at is null
    and not private.blocked_between(m.person_id, new.person_id)
    and private.wants(m.person_id, 'room_open')
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.notify_room_open() from public;
create trigger room_members_notify_open after insert or update of left_at on public.room_members
  for each row execute function private.notify_room_open();

-- #6: the first message since you last looked, then nothing from this room for an hour.
-- Not to the author, not across a block, not to someone looking right now (seen in the
-- last two minutes), and not to someone who switched it off.
create function private.notify_room_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_gathering uuid;
begin
  select r.gathering_id into v_gathering from public.rooms r where r.id = new.room_id;
  insert into public.notifications (person_id, kind, gathering_id, room_id, title, body, path)
  select m.person_id, 'room_activity', v_gathering, new.room_id,
         private.gathering_name(v_gathering),
         'New messages in the ' || private.gathering_name(v_gathering) || ' room',
         private.crowd_path(v_gathering)
  from public.room_members m
  join public.people them on them.id = m.person_id
  where m.room_id = new.room_id and m.left_at is null and m.person_id <> new.author_id
    and them.hidden_at is null
    and not private.blocked_between(m.person_id, new.author_id)
    and private.wants(m.person_id, 'room_activity')
    and (m.last_seen_at is null or m.last_seen_at < now() - interval '2 minutes')
    and not exists (
      select 1 from public.notifications n
      where n.person_id = m.person_id and n.room_id = new.room_id and n.kind = 'room_activity'
        and n.created_at > least(now() - interval '1 hour', coalesce(m.last_seen_at, '-infinity'::timestamptz))
    );
  return new;
end;
$$;
revoke all on function private.notify_room_activity() from public;
create trigger room_messages_notify_activity after insert on public.room_messages
  for each row execute function private.notify_room_activity();

-- ---------------------------------------------------------------------------
-- Delivery, for the Worker (service key only)
-- ---------------------------------------------------------------------------

-- The unsent, with where each can go: the person's phones, else their email.
create function public.admin_pending_notifications(p_limit integer default 100)
returns table (id uuid, person_id uuid, kind public.notification_kind, title text, body text, path text, attempts smallint,
               tokens text[], email text)
language sql stable security definer set search_path = '' as $$
  select n.id, n.person_id, n.kind, n.title, n.body, n.path, n.attempts,
    array(select d.token from public.device_tokens d where d.person_id = n.person_id order by d.last_seen_at desc),
    (select u.email::text from public.people p join auth.users u on u.id = p.auth_user_id
      where p.id = n.person_id and not coalesce(u.is_anonymous, false))
  from public.notifications n
  where n.sent_at is null and n.attempts < 3
  order by n.created_at
  limit p_limit;
$$;
revoke all on function public.admin_pending_notifications(integer) from public, anon, authenticated;
grant execute on function public.admin_pending_notifications(integer) to service_role;

create function public.admin_mark_notification(p_id uuid, p_channel text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.notifications
  set attempts = attempts + 1,
      last_error = p_error,
      channel = case when p_error is null then p_channel else channel end,
      sent_at = case when p_error is null then now() else sent_at end
  where id = p_id;
$$;
revoke all on function public.admin_mark_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_mark_notification(uuid, text, text) to service_role;

-- A phone Expo says is gone is forgotten.
create function public.admin_forget_device(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.device_tokens where token = p_token;
$$;
revoke all on function public.admin_forget_device(text) from public, anon, authenticated;
grant execute on function public.admin_forget_device(text) to service_role;

-- One tap off, from the email itself: the Worker checks a signed link and calls this.
create function public.admin_switch_off(p_person uuid, p_kind public.notification_kind) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_settings (person_id) values (p_person) on conflict (person_id) do nothing;
  execute format('update public.notification_settings set %I = false, updated_at = now() where person_id = $1', p_kind::text)
  using p_person;
end;
$$;
revoke all on function public.admin_switch_off(uuid, public.notification_kind) from public, anon, authenticated;
grant execute on function public.admin_switch_off(uuid, public.notification_kind) to service_role;
