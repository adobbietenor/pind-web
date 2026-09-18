-- Phase 1 M1.1 — privileges and RLS policies (docs/visibility.md).
--
-- Two layers, both in the database (H11):
--   1. Privileges say which verbs and which COLUMNS a role may use at all.
--   2. Policies say which ROWS.
-- Every visitor privilege is first revoked, then granted back exactly. Tables not
-- granted below (the app-phase tables, magic_links, outbound_messages) stay fully
-- locked for anon and authenticated. The service key bypasses both layers.
--
-- Roles: anon = visitor before pinning (no session). authenticated = a signed-in
-- visitor (Supabase anonymous sign-in) or, later, an app user — same rules.

revoke all on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public reference data — V11
-- ---------------------------------------------------------------------------

grant select on public.venues, public.meeting_spots, public.neighbourhoods,
                public.gatherings, public.gathering_spots
  to anon, authenticated;

create policy venues_read on public.venues
  for select to anon, authenticated using (true);

create policy meeting_spots_read on public.meeting_spots
  for select to anon, authenticated using (true);

create policy neighbourhoods_read on public.neighbourhoods
  for select to anon, authenticated using (true);

create policy gatherings_read_published on public.gatherings
  for select to anon, authenticated using (published_at is not null);

create policy gathering_spots_read_published on public.gathering_spots
  for select to anon, authenticated
  using (exists (
    select 1 from public.gatherings g where g.id = gathering_id and g.published_at is not null
  ));

-- ---------------------------------------------------------------------------
-- people — V1, V6. Readable by the owner and by people V1 lets see them.
-- Moderation columns (hidden_at, photo_status) are never writable by visitors.
-- ---------------------------------------------------------------------------

grant select on public.people to authenticated;
grant insert (auth_user_id, first_name, last_initial, photo_path, instagram_handle, neighbourhood)
  on public.people to authenticated;
grant update (first_name, last_initial, photo_path, instagram_handle, neighbourhood)
  on public.people to authenticated;

create policy people_read_self on public.people
  for select to authenticated using (auth_user_id = (select auth.uid()));

create policy people_read_visible on public.people
  for select to authenticated using (private.can_see(id));

-- One person per session (unique auth_user_id); a photo path only in their own folder.
create policy people_insert_self on public.people
  for insert to authenticated
  with check (
    auth_user_id = (select auth.uid())
    and (photo_path is null or split_part(photo_path, '/', 1) = (select auth.uid())::text)
  );

create policy people_update_self on public.people
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (
    auth_user_id = (select auth.uid())
    and (photo_path is null or split_part(photo_path, '/', 1) = (select auth.uid())::text)
  );

-- ---------------------------------------------------------------------------
-- people_private — D1. Owner only, always.
-- ---------------------------------------------------------------------------

grant select on public.people_private to authenticated;
grant insert (person_id, gender, include_in_women_only, birth_year, age_attested_at)
  on public.people_private to authenticated;
grant update (gender, include_in_women_only) on public.people_private to authenticated;

create policy people_private_read_own on public.people_private
  for select to authenticated using (person_id = private.me());

create policy people_private_insert_own on public.people_private
  for insert to authenticated with check (person_id = private.me());

create policy people_private_update_own on public.people_private
  for update to authenticated
  using (person_id = private.me()) with check (person_id = private.me());

-- ---------------------------------------------------------------------------
-- pins — V1, V8, V11. Own pins; plus opted-in pins of people V1 lets me see, at
-- that gathering only.
-- ---------------------------------------------------------------------------

grant select, delete on public.pins to authenticated;
grant insert (gathering_id, person_id, party_total, open_to_meeting) on public.pins to authenticated;
grant update (party_total, open_to_meeting) on public.pins to authenticated;

create policy pins_read_own on public.pins
  for select to authenticated using (person_id = private.me());

create policy pins_read_visible on public.pins
  for select to authenticated using (private.can_see_at(person_id, gathering_id));

create policy pins_insert_own on public.pins
  for insert to authenticated
  with check (person_id = private.me() and private.is_published(gathering_id));

create policy pins_update_own on public.pins
  for update to authenticated
  using (person_id = private.me()) with check (person_id = private.me());

create policy pins_delete_own on public.pins
  for delete to authenticated using (person_id = private.me());

-- ---------------------------------------------------------------------------
-- pin_friends — V7. The host reads their own +1s; others read a CLAIMED +1 only
-- when they can see its host at that gathering. claim_token_hash and the +1's age
-- attestation are not granted to anyone. Writes come with T10.
-- ---------------------------------------------------------------------------

grant select (id, pin_id, first_name, claimed_at, created_at) on public.pin_friends to authenticated;

create policy pin_friends_read_host on public.pin_friends
  for select to authenticated
  using (exists (
    select 1 from public.pins p where p.id = pin_id and p.person_id = private.me()
  ));

create policy pin_friends_read_claimed_visible on public.pin_friends
  for select to authenticated
  using (
    claimed_at is not null
    and exists (
      select 1 from public.pins p
      where p.id = pin_id and private.can_see_at(p.person_id, p.gathering_id)
    )
  );

-- ---------------------------------------------------------------------------
-- contact_points — owner only. Opt-outs are recorded by the service key.
-- ---------------------------------------------------------------------------

grant select on public.contact_points to authenticated;
grant insert (person_id, kind, value) on public.contact_points to authenticated;
grant update (value) on public.contact_points to authenticated;

create policy contact_points_read_own on public.contact_points
  for select to authenticated using (person_id = private.me());

create policy contact_points_insert_own on public.contact_points
  for insert to authenticated with check (person_id = private.me());

create policy contact_points_update_own on public.contact_points
  for update to authenticated
  using (person_id = private.me()) with check (person_id = private.me());

-- ---------------------------------------------------------------------------
-- spot_votes — own rows only; counts come from public.spot_poll. Voting needs me
-- pinned and opted in at that gathering. One vote per gathering (primary key);
-- changing it is an update of gathering_spot_id.
-- ---------------------------------------------------------------------------

grant select, delete on public.spot_votes to authenticated;
grant insert (gathering_id, gathering_spot_id, person_id) on public.spot_votes to authenticated;
grant update (gathering_spot_id) on public.spot_votes to authenticated;

create policy spot_votes_read_own on public.spot_votes
  for select to authenticated using (person_id = private.me());

create policy spot_votes_insert_own on public.spot_votes
  for insert to authenticated
  with check (person_id = private.me() and private.i_am_open_at(gathering_id));

create policy spot_votes_update_own on public.spot_votes
  for update to authenticated
  using (person_id = private.me())
  with check (person_id = private.me() and private.i_am_open_at(gathering_id));

create policy spot_votes_delete_own on public.spot_votes
  for delete to authenticated using (person_id = private.me());

-- ---------------------------------------------------------------------------
-- gathering_group_links — V5. Written by admin (service key) only.
-- ---------------------------------------------------------------------------

grant select on public.gathering_group_links to authenticated;

create policy group_links_read_everyone on public.gathering_group_links
  for select to authenticated
  using (kind = 'everyone' and private.i_am_open_at(gathering_id));

create policy group_links_read_women_only on public.gathering_group_links
  for select to authenticated
  using (kind = 'women_only' and private.women_only_open(gathering_id));

-- ---------------------------------------------------------------------------
-- blocks — V4. The blocker creates and reads their own rows; the blocked person
-- can never read them. No unblock in Test 0 (A23).
-- ---------------------------------------------------------------------------

grant select on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;

create policy blocks_read_own on public.blocks
  for select to authenticated using (blocker_id = private.me());

create policy blocks_insert_own on public.blocks
  for insert to authenticated with check (blocker_id = private.me());

-- ---------------------------------------------------------------------------
-- reports — V9. File a report on a person I can see; read none. Status and
-- is_safety are never set by the reporter. Crew and message reports come with the app.
-- ---------------------------------------------------------------------------

grant insert (reporter_id, target_kind, target_person_id, reason) on public.reports to authenticated;

create policy reports_insert_on_visible_person on public.reports
  for insert to authenticated
  with check (
    reporter_id = private.me()
    and target_kind = 'person'
    and target_person_id is not null
    and private.can_see(target_person_id)
  );

-- ---------------------------------------------------------------------------
-- survey_responses — own only; admin reads them with the service key.
-- ---------------------------------------------------------------------------

grant select on public.survey_responses to authenticated;
grant insert (gathering_id, person_id, met, would_have_gone, anything_off)
  on public.survey_responses to authenticated;

create policy survey_responses_read_own on public.survey_responses
  for select to authenticated using (person_id = private.me());

create policy survey_responses_insert_own on public.survey_responses
  for insert to authenticated
  with check (person_id = private.me() and private.is_published(gathering_id));
