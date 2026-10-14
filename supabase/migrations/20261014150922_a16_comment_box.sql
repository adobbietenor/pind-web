-- A16's comment box (#10; Alex, 14 Oct 2026 — decisions, "A16's comment box").
--
-- Who can see what (approved by Alex, 14 Oct 2026):
--   * WRITE: only the person answering, about themselves, together with their answer,
--     once — pinned and open to meeting at the gathering, after its end. These are the
--     answer's own rules (survey_responses_insert_own, M3.3) and are unchanged. There is
--     no update or delete grant, so it cannot be edited.
--   * READ: the person who wrote it (survey_responses_read_own, unchanged), and the
--     team in the admin through the service key. Nobody else: not their group, their
--     connections, anyone they met, any public page, any notification.
--   * WHETHER IT HAS BEEN READ: survey_comment_reads, which only the service key can
--     touch, so the writer never learns whether the team has read it.
--   * DELETED WITH THE ACCOUNT: when the answer loses its person (people → set null,
--     however the person goes), the comment is cleared in the same statement. The
--     answer stays, without a name, as answers always have.
-- No V17 filter: no other person can ever read a comment.

-- 1. anything_off → comment. A Test 0 leftover, in no document, never written (staging,
--    14 Oct: 0 of 5 answers), but in M1.1's insert grant. Renamed rather than reused
--    under a name that means something else.
alter table public.survey_responses rename column anything_off to comment;

alter table public.survey_responses
  add constraint survey_responses_comment_shape
  check (comment is null or (char_length(comment) <= 1000 and btrim(comment) <> ''));

comment on column public.survey_responses.comment is
  'A16: optional free text sent with the answer, up to 1,000 characters. Read by its author and by the team (admin) only. Cleared when the answer loses its person (account deleted).';

-- Column privileges follow a rename; restated so the grant reads as it is.
revoke insert on public.survey_responses from authenticated;
grant insert (gathering_id, person_id, met, would_have_gone, comment) on public.survey_responses to authenticated;

-- 2. Deleted with the account. people → survey_responses is "on delete set null"; that
--    is an UPDATE of person_id, and this runs in it.
create function private.survey_comment_leaves_with_person() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.person_id is not null and new.person_id is null then
    new.comment := null;
  end if;
  return new;
end;
$$;
revoke all on function private.survey_comment_leaves_with_person() from public;

create trigger survey_comment_leaves_with_person
  before update of person_id on public.survey_responses
  for each row execute function private.survey_comment_leaves_with_person();

-- 3. Whether the team has read a comment. The service key only: RLS on, no policies,
--    no grants — the writer can never read it.
create table public.survey_comment_reads (
  response_id uuid primary key references public.survey_responses (id) on delete cascade,
  read_by     text not null,
  read_at     timestamptz not null default now()
);
alter table public.survey_comment_reads enable row level security;
revoke all on public.survey_comment_reads from public, anon, authenticated;

-- 4. The admin's three calls. Unread: a comment with no read row. The count goes in
--    every admin page's nav, so an unread pile is a number, not invisible (Alex, b).
create function public.admin_unread_comments() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from public.survey_responses s
  where s.comment is not null
    and not exists (select 1 from public.survey_comment_reads r where r.response_id = s.id);
$$;
revoke execute on function public.admin_unread_comments() from public, anon, authenticated;
grant execute on function public.admin_unread_comments() to service_role;

create function public.admin_comments(p_limit integer default 200)
returns table (
  id uuid, gathering_id uuid, gathering_name text, starts_at timestamptz,
  first_name text, would_have_gone public.survey_would_have_gone, comment text,
  created_at timestamptz, read_at timestamptz, read_by text
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.gathering_id, g.name, g.starts_at, p.first_name, s.would_have_gone, s.comment,
         s.created_at, r.read_at, r.read_by
  from public.survey_responses s
  join public.gatherings g on g.id = s.gathering_id
  left join public.people p on p.id = s.person_id
  left join public.survey_comment_reads r on r.response_id = s.id
  where s.comment is not null
  order by (r.response_id is null) desc, s.created_at desc
  limit greatest(p_limit, 0);
$$;
revoke execute on function public.admin_comments(integer) from public, anon, authenticated;
grant execute on function public.admin_comments(integer) to service_role;

create function public.admin_comment_read(p_actor text, p_response uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.survey_responses where id = p_response and comment is not null) then
    raise exception 'no such comment';
  end if;
  insert into public.survey_comment_reads (response_id, read_by)
  values (p_response, p_actor)
  on conflict (response_id) do nothing;
end;
$$;
revoke execute on function public.admin_comment_read(text, uuid) from public, anon, authenticated;
grant execute on function public.admin_comment_read(text, uuid) to service_role;
