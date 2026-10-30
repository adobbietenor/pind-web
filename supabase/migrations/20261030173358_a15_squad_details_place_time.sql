-- A15 / A11 — a squad's details, place and time (UI pass 1, group 2 C; Alex, 30 Oct 2026,
-- calls 1 and f).
--
-- The rule, in plain English (approved before this was written):
--   * Starting a squad needs a name. Details (up to 200 characters), a place and a time
--     (up to 40 characters, free text: "around 5:30") are optional.
--   * **The place is never free text (H5 stands).** It is one of this venue's curated
--     public spots, or nothing, which means the event itself. An address cannot be typed.
--   * Any member can change the name, details, place and time afterwards.
--   * Who sees the squad and its words: exactly who sees the card today (can_see_squad).
--     **The words are free text a stranger reads, so the whole card is checked**: the
--     name check now judges the name, the details and the time together, and the card
--     is listed only once that exact text has passed. An edit puts it back to "being
--     checked" (its members still see their own squad; nobody else does until it passes).
--   * Before any of that, a filter refuses handles, links, emails and phone numbers in the
--     name, details or time (M3.1: "any free-text field a stranger can read is a V17
--     bypass unless it is filtered").
--   * The squad's own lifecycle is unchanged. Its meet_at is now the gathering's start
--     (the time is words, not a clock), so it is listed until the start, as before it
--     was listed until its time.
--
-- The older start_squad (spot and a time from the list) stays for app builds already
-- installed; it is unchanged.

alter table public.crews add column details text
  check (details is null or (char_length(btrim(details)) between 1 and 200));
alter table public.crews add column time_note text
  check (time_note is null or (char_length(btrim(time_note)) between 1 and 40 and time_note !~ '[[:cntrl:]]'));
comment on column public.crews.details is 'A squad''s optional details (UI pass 1), checked with its name before it is listed.';
comment on column public.crews.time_note is 'A squad''s optional time, in words (UI pass 1), checked with its name before it is listed.';

-- Handles, links, emails and phone numbers: never on a card a stranger reads.
create function private.has_contact(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p, '') ~* '(@[a-z0-9_.]{2,})|(https?://)|(\mwww\.)|(\m[a-z0-9-]+\.(com|ca|net|org|io|me|co|app|ly|gg|link|social)\M)|((\d[\s().+-]*){7,})|(\m(instagram|insta|snapchat|tiktok|whatsapp|telegram|signal|discord)\M)';
$$;

-- What the check judges and what it must still match when it answers: the whole card.
create function private.squad_card_text(p_crew uuid) returns text
language sql stable security definer set search_path = '' as $$
  select concat_ws(E'\n', c.name, c.details, c.time_note) from public.crews c where c.id = p_crew;
$$;
revoke all on function private.squad_card_text(uuid) from public, anon, authenticated;

create function private.check_squad_words(p_name text, p_details text, p_time text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if char_length(p_name) not between 1 and 40 or p_name ~ '[[:cntrl:]]' then
    raise exception 'refused: a name of 1 to 40 characters' using errcode = '22023', hint = 'squad_name';
  end if;
  if p_details is not null and char_length(p_details) > 200 then
    raise exception 'refused: details of up to 200 characters' using errcode = '22023', hint = 'squad_details';
  end if;
  if p_time is not null and (char_length(p_time) > 40 or p_time ~ '[[:cntrl:]]') then
    raise exception 'refused: a time of up to 40 characters' using errcode = '22023', hint = 'squad_time_note';
  end if;
  if private.has_contact(p_name) or private.has_contact(p_details) or private.has_contact(p_time) then
    raise exception 'refused: no handles, links or numbers' using errcode = '22023', hint = 'squad_contact';
  end if;
end;
$$;

-- A place is one of this venue's active curated spots, or null (the event itself).
create function private.check_squad_place(p_gathering uuid, p_spot uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_spot is not null and not exists (
    select 1 from public.meeting_spots s join public.gatherings g on g.venue_id = s.venue_id
    where s.id = p_spot and g.id = p_gathering and s.active
  ) then
    raise exception 'refused: not one of this venue''s spots' using errcode = '22023', hint = 'squad_spot';
  end if;
end;
$$;
revoke all on function private.check_squad_place(uuid, uuid) from public, anon, authenticated;

create function public.start_squad(p_gathering uuid, p_name text, p_details text, p_spot uuid, p_time_note text, p_women_only boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_g public.gatherings;
  v_name text := btrim(coalesce(p_name, ''));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_time text := nullif(btrim(coalesce(p_time_note, '')), '');
  v_women boolean;
  v_crew uuid;
begin
  perform private.lock_people(array[v_me]);
  select * into v_g from public.gatherings where id = p_gathering;
  if v_me is null or v_g.id is null or v_g.withdrawn_at is not null
     or not private.is_open_at(v_me, p_gathering) or private.is_hidden(v_me) then
    raise exception 'refused: pin in and open to meeting first' using errcode = '42501', hint = 'squad_not_open_to_meeting';
  end if;
  if now() >= v_g.starts_at then
    raise exception 'refused: squads close at the start' using errcode = '42501', hint = 'squad_closed';
  end if;
  perform private.check_squad_words(v_name, v_details, v_time);
  perform private.check_squad_place(p_gathering, p_spot);
  v_women := coalesce(p_women_only, false) or private.women_only_only(v_me);
  if v_women and not private.is_women_only_eligible(v_me) then
    raise exception 'refused: not eligible for women only' using errcode = '42501', hint = 'squad_not_eligible';
  end if;
  if private.in_a_group_at(v_me, p_gathering) then
    raise exception 'refused: already in a group here' using errcode = '42501', hint = 'squad_in_group';
  end if;
  if (select count(*) from public.crews c
      where c.gathering_id = p_gathering and c.created_by = v_me and c.kind = 'crew' and not c.legacy) >= 3 then
    raise exception 'refused: three squads started here' using errcode = '42501', hint = 'squad_start_limit';
  end if;
  insert into public.crews (gathering_id, kind, state, spot_id, meet_at, name, details, time_note, name_status, created_by, women_only)
  values (p_gathering, 'crew', 'spot_set', p_spot, v_g.starts_at, v_name, v_details, v_time, 'pending', v_me, v_women)
  returning id into v_crew;
  insert into public.crew_members (crew_id, gathering_id, person_id, seats)
  values (v_crew, p_gathering, v_me, private.my_seats(v_me, p_gathering));
  return v_crew;
end;
$$;
revoke all on function public.start_squad(uuid, text, text, uuid, text, boolean) from public, anon;
grant execute on function public.start_squad(uuid, text, text, uuid, text, boolean) to authenticated;

-- Any member changes the words or the place (call f). Changed words go back to the check.
create function public.edit_squad(p_crew uuid, p_name text, p_details text, p_spot uuid, p_time_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_c public.crews;
  v_name text := btrim(coalesce(p_name, ''));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_time text := nullif(btrim(coalesce(p_time_note, '')), '');
begin
  select * into v_c from public.crews where id = p_crew for update;
  if v_me is null or v_c.id is null or v_c.kind <> 'crew' or v_c.legacy or v_c.state not in ('spot_set', 'live')
     or not exists (select 1 from public.crew_members m where m.crew_id = p_crew and m.person_id = v_me and m.left_at is null) then
    raise exception 'refused: not your squad' using errcode = '42501', hint = 'squad_not_member';
  end if;
  perform private.check_squad_words(v_name, v_details, v_time);
  perform private.check_squad_place(v_c.gathering_id, p_spot);
  update public.crews set
    name = v_name, details = v_details, time_note = v_time, spot_id = p_spot,
    name_status = case
      when v_name is distinct from v_c.name or v_details is distinct from v_c.details or v_time is distinct from v_c.time_note
        then 'pending'::public.squad_name_status
      else v_c.name_status end
  where id = p_crew;
end;
$$;
revoke all on function public.edit_squad(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.edit_squad(uuid, text, text, uuid, text) to authenticated;

-- The list now carries the words (only cards whose whole text passed are in it).
drop function public.squads(uuid);
create function public.squads(p_gathering uuid)
returns table (crew_id uuid, name text, details text, time_note text, women_only boolean, spot_id uuid, spot text, meet_at timestamptz,
               seats integer, is_full boolean, members jsonb)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.details, c.time_note, c.women_only, c.spot_id, s.name, c.meet_at,
         private.squad_seats(c.id), private.squad_seats(c.id) >= 8,
         coalesce((
           select jsonb_agg(jsonb_build_object('person_id', p.id, 'first_name', p.first_name) order by m.joined_at)
           from public.crew_members m join public.people p on p.id = m.person_id
           where m.crew_id = c.id and m.left_at is null and private.can_see_at(m.person_id, c.gathering_id)
         ), '[]'::jsonb)
  from public.crews c
  left join public.meeting_spots s on s.id = c.spot_id
  where c.gathering_id = p_gathering
    and private.can_see_squad(c.id)
    and not private.in_group(c.id)
  order by private.squad_seats(c.id) >= 8, c.meet_at, c.created_at;
$$;
revoke all on function public.squads(uuid) from public, anon;
grant execute on function public.squads(uuid) to authenticated;

-- The check answers for the text it judged: the whole card, not the name alone. A card
-- edited while it was being judged stays pending (the old verdict matches nothing).
create or replace function public.admin_record_squad_name_check(
  p_crew uuid, p_name text, p_outcome text, p_source text, p_reason text default null, p_model text default null,
  p_cost numeric default 0, p_duration_ms integer default null, p_error text default null
) returns public.squad_name_status
language plpgsql security definer set search_path = '' as $fn$
declare applied public.squad_name_status;
begin
  insert into public.squad_name_checks (crew_id, name, outcome, source, reason, model, ai_cost_usd, duration_ms, error)
  values (p_crew, p_name, p_outcome, p_source, p_reason, p_model, coalesce(p_cost, 0), p_duration_ms, p_error);
  if p_outcome = 'failed' then
    return null;
  end if;
  update public.crews c set name_status = p_outcome::public.squad_name_status
  where c.id = p_crew and private.squad_card_text(c.id) = p_name and c.name_status = 'pending'
  returning c.name_status into applied;
  if applied is not null then
    insert into public.moderation_log (actor, action, gathering_id, note)
    select 'ai:squad-name', 'squad_name_' || p_outcome, c.gathering_id, left(p_name || coalesce(' — ' || p_reason, ''), 500)
    from public.crews c where c.id = p_crew;
  end if;
  return applied;
end;
$fn$;

-- The webhook fires on changed words too, not only on a changed name.
create or replace function private.squad_name_webhook() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  target text;
  secret text;
begin
  if new.kind <> 'crew' or new.legacy or new.name is null or new.name_status <> 'pending' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.name is not distinct from new.name and old.name_status is not distinct from new.name_status
     and old.details is not distinct from new.details and old.time_note is not distinct from new.time_note then
    return new;
  end if;
  if exists (select 1 from public.people p where p.id = new.created_by and private.is_harness_user(p.auth_user_id)) then
    return new;
  end if;
  select btrim(decrypted_secret) into target from vault.decrypted_secrets where name = 'photo_check_url';
  select btrim(decrypted_secret) into secret from vault.decrypted_secrets where name = 'photo_check_secret';
  if target is null or position('/hooks/photo-check' in target) = 0 or secret is null or secret = '' then
    return new;
  end if;
  perform net.http_post(
    url := replace(target, '/hooks/photo-check', '/hooks/squad-name'),
    headers := jsonb_build_object('content-type', 'application/json', 'x-pind-webhook', secret),
    body := jsonb_build_object('type', tg_op, 'table', 'crews', 'record', jsonb_build_object('id', new.id)),
    timeout_milliseconds := 5000
  );
  return new;
end;
$fn$;
drop trigger crews_squad_name_webhook on public.crews;
create trigger crews_squad_name_webhook
  after insert or update of name, name_status, details, time_note on public.crews
  for each row execute function private.squad_name_webhook();
