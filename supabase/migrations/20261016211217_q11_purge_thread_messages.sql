-- Q11 for squad and 1-on-1 threads: deleted 30 days after the read-only day begins, as
-- room messages are (Alex, 16 Oct 2026).
--
-- The privacy page has promised "Crew messages — read-only 24 hours after the gathering,
-- deleted 30 days after it", and nothing did it: the only purge was room messages'
-- (admin_delete_expired_room_messages, M3.3). Found while building A19. This makes the
-- live promise true, with exactly the room's rule — a message goes once
-- now() >= effective end + 24 hours + 30 days — and the room's schedule (09:15 UTC daily).
--
-- Every thread message goes, a person's and a system line alike, whatever state the
-- group ended in (done, dissolved, a pre-M3.7 group). A report that pointed at one keeps
-- its row: reports.target_message_id is "on delete set null" (message reports are
-- retired, 16 Oct 2026; the old ones stay as history). Proved both ways by P254.

create function public.admin_delete_expired_crew_messages() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.crew_messages m
  using public.crews c, public.gatherings g
  where c.id = m.crew_id and g.id = c.gathering_id
    and now() >= public.effective_end(g) + interval '24 hours' + interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.admin_delete_expired_crew_messages() from public, anon, authenticated;
grant execute on function public.admin_delete_expired_crew_messages() to service_role;
select cron.schedule('pind-delete-expired-crew-messages', '15 9 * * *', $$select public.admin_delete_expired_crew_messages()$$);
