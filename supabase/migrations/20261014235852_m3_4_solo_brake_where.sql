-- M3.4: the brake's setter, with a WHERE. pind-staging refuses an UPDATE without one
-- (21000), so the first version could never be pulled — found by P226's first run.

create or replace function public.admin_set_solo_brake(p_pulled boolean, p_actor text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_dropped integer;
begin
  update private.solo_brake
  set pulled = p_pulled,
      pulled_at = case when p_pulled then now() else pulled_at end,
      changed_at = now()
  where id;
  v_dropped := private.drop_braked_solo_notifications();
  insert into public.moderation_log (actor, action, note)
  values (p_actor, case when p_pulled then 'solo_brake_pulled' else 'solo_brake_lifted' end,
          v_dropped || ' proposal notification(s) dropped');
  return v_dropped;
end;
$$;
