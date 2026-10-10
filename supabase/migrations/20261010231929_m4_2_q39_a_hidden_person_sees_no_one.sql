-- M4.2 — Q39: a hidden person sees no one, from inside a group too (V10 §11: "invisible to
-- everyone, cannot see anyone themselves"; V23; Alex, 10 Oct 2026).
--
-- What the review found: private.after_peer — the group-and-connection branch of
-- private.can_see — checked that the TARGET is not hidden, never the VIEWER. A person
-- hidden by moderation who was still in a small group (a hide empties rooms, not groups)
-- kept seeing the other members' names, photos and tags. And because the person-report
-- policy (reports_insert_on_visible_person) goes through can_see, they could still file
-- an "uncomfortable" report that instantly hid another member — retaliation by a
-- moderated person. Alex: close both halves.
--
-- The fix: after_peer answers false when the viewer is hidden — the same rule the list
-- branch already applies through is_open_at. That closes both halves in one place: a
-- hidden person sees no group member or connection, and cannot report one (the report
-- policy needs can_see). The body is otherwise exactly 20261006230954's. Proved by P201;
-- Q39 in the review suite turns green.

create or replace function private.after_peer(p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select me.id <> p_target
       and not private.is_hidden(me.id)
       and not private.blocked_between(me.id, p_target)
       and exists (
         select 1 from public.people t
         where t.id = p_target and t.hidden_at is null and (not t.is_seed or private.i_am_tester())
       )
       and (
         private.are_connected(p_target)
         or exists (
           select 1 from public.crew_members mine
           join public.crew_members theirs on theirs.crew_id = mine.crew_id
           join public.crews c on c.id = mine.crew_id
           where mine.person_id = me.id and mine.left_at is null
             and theirs.person_id = p_target and theirs.left_at is null
             and (private.after_open(mine.crew_id) or c.state in ('forming', 'spot_set', 'live'))
         )
       )
    from (select private.me() as id) me
    where me.id is not null
  ), false);
$$;
