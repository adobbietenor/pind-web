-- M3.2 — which version of the privacy policy and terms a person accepted (Alex, M3.2).
--
-- The pages at /privacy and /terms are drafts (POLICY_VERSION, packages/shared). A27's
-- safety sheet is where they are accepted, and M4.1 replaces them with lawyer-read
-- versions and asks everybody again — which only works if what each person accepted
-- is on record.
--
--   * one row per acceptance: who, which version, when;
--   * written by the person themselves, for themselves (P110);
--   * readable only by them — and the admin, with the service key (P111);
--   * never changed or deleted by anyone signed in: a new version adds a new row (P112).

create table public.policy_acceptances (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id) on delete cascade,
  version     text not null check (char_length(version) between 1 and 64),
  accepted_at timestamptz not null default now(),
  unique (person_id, version)
);
alter table public.policy_acceptances enable row level security;

comment on table public.policy_acceptances is
  'Which privacy policy / terms version a person accepted, and when (A27, M3.2). Owner-only, append-only.';

revoke all on public.policy_acceptances from public, anon, authenticated;
grant select on public.policy_acceptances to authenticated;
grant insert (person_id, version) on public.policy_acceptances to authenticated;

create policy policy_acceptances_read_own on public.policy_acceptances
  for select to authenticated using (person_id = private.me());

create policy policy_acceptances_insert_own on public.policy_acceptances
  for insert to authenticated with check (person_id = private.me());
