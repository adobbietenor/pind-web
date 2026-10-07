-- M3.3 — every merge records itself, at the moment it happens (build plan §8 M3.3,
-- "the returning person"; spec §7, "Session lost (web)").
--
-- A merge means someone arrived at a pin with no session and turned out to have an
-- account. Counted per week, split by "Already on Pin'd?" or the sign-in step, by email,
-- Apple or Google, and web or app, it is the number that decides fix 3 — a longer-lived
-- web session — once more than 1 in 5 returning web pinners arrive with their session
-- lost (decisions, "Does a session last?").
--
-- **Written by the merge itself, in the same transaction** (CLAUDE.md, "record at the
-- moment"): `admin_merge_recorded` merges and writes the row together, so there is no
-- merge without its record and no record without its merge. How the person signed in,
-- the platform and the route come from the app; the Worker passes only the listed
-- values, and anything else is recorded as not known rather than guessed.
--
-- Service key only: nobody signed in reads or writes it.

create table public.account_merges (
  id          uuid primary key default gen_random_uuid(),
  merged_at   timestamptz not null default now(),
  person_id   uuid references public.people (id) on delete set null,
  method      text check (method in ('email', 'apple', 'google')),
  platform    text check (platform in ('web', 'ios', 'android')),
  via         text check (via in ('already_on_pind', 'sign_in_step'))
);
alter table public.account_merges enable row level security;
revoke all on public.account_merges from public, anon, authenticated;
create index account_merges_merged_at_idx on public.account_merges (merged_at);
comment on table public.account_merges is
  'One row per anonymous→account merge, written by admin_merge_recorded in the merge''s own transaction (spec §7, "Session lost (web)").';

create function public.admin_merge_recorded(
  p_anon uuid, p_perm uuid, p_photo_dest text, p_method text, p_platform text, p_via text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  v_result := public.admin_merge_anonymous(p_anon, p_perm, p_photo_dest);
  insert into public.account_merges (person_id, method, platform, via)
  values (
    (select pe.id from public.people pe where pe.auth_user_id = p_perm),
    case when p_method in ('email', 'apple', 'google') then p_method end,
    case when p_platform in ('web', 'ios', 'android') then p_platform end,
    case when p_via in ('already_on_pind', 'sign_in_step') then p_via end
  );
  return v_result;
end;
$$;
revoke all on function public.admin_merge_recorded(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_merge_recorded(uuid, uuid, text, text, text, text) to service_role;
