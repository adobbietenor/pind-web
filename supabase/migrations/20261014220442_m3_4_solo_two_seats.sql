-- M3.4 — a 1-on-1 plan has two seats, held by the database, not only by the accept that
-- fills them (decisions, "M3.4: the 1-on-1 lifecycle"). Without this, nothing but
-- respond_to_solo's own insert kept a third person out. Proved by P219.
create function private.solo_two_seats() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'solo' and new.left_at is null
     and (select count(*) from public.crew_members m
          where m.crew_id = new.crew_id and m.left_at is null and m.id <> new.id) >= 2 then
    raise exception 'A 1-on-1 plan has two seats.' using errcode = 'check_violation', hint = 'solo_two_seats';
  end if;
  return new;
end;
$$;
revoke all on function private.solo_two_seats() from public;
create trigger crew_members_solo_two_seats before insert or update of left_at on public.crew_members
  for each row execute function private.solo_two_seats();
