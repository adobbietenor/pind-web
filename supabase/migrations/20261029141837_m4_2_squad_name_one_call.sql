-- M4.2 (29 Oct 2026), F8's last part, approved by Alex: one AI call per name, not two.
--
-- Starting or renaming a squad fires the database webhook and the app's own call to
-- /squad-name-check within milliseconds; both re-read the name as pending and both called
-- the model, each cost recorded against the daily cap (the review, from code). Now the
-- Worker claims the check — this squad, this name — immediately before it calls the model,
-- and the second caller finds it claimed and stops. A claim lapses after 10 minutes, so a
-- call that died does not strand the name: the hourly sweep checks it again.

create table private.squad_name_claims (
  crew_id     uuid not null references public.crews (id) on delete cascade,
  name_key    text not null,
  claimed_at  timestamptz not null default now(),
  primary key (crew_id, name_key)
);
alter table private.squad_name_claims enable row level security;
revoke all on private.squad_name_claims from public, anon, authenticated;
comment on table private.squad_name_claims is
  'Which squad names are being checked right now (M4.2): one AI call per name. Written only by admin_claim_squad_name_check.';

-- True for the one caller who may call the model for this squad's name now; false for
-- anyone else within 10 minutes of that claim.
create function public.admin_claim_squad_name_check(p_crew uuid, p_name text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_got boolean;
begin
  insert into private.squad_name_claims as c (crew_id, name_key)
  values (p_crew, private.squad_name_key(p_name))
  on conflict (crew_id, name_key) do update set claimed_at = now()
    where c.claimed_at < now() - interval '10 minutes'
  returning true into v_got;
  return coalesce(v_got, false);
end;
$$;
revoke all on function public.admin_claim_squad_name_check(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_claim_squad_name_check(uuid, text) to service_role;
