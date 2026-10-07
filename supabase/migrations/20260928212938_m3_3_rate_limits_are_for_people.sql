-- M3.3 — the room's rate limits apply to people, not to the service key.
--
-- One message every 3 seconds and 200 a day are limits on a person's session. The
-- service key (admin, jobs, the harness) writes outside them: the harness sets up 200
-- earlier messages in one statement and then proves a person's 201st is refused (the
-- limit is proved by making it refuse — CLAUDE.md). A person can never reach this
-- branch: the role comes from the verified JWT, and only the service key carries it.

create or replace function private.room_messages_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if exists (
    select 1 from public.room_messages m
    where m.author_id = new.author_id and m.created_at > now() - interval '3 seconds'
  ) then
    raise exception 'slow down: one message every 3 seconds' using errcode = '23514';
  end if;
  if (select count(*) from public.room_messages m
      where m.author_id = new.author_id and m.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'that is 200 messages today' using errcode = '23514';
  end if;
  new.created_at := now();
  new.hidden_at := null;
  return new;
end;
$$;
