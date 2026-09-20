-- Phase 2 M2.2 — fix for 20260920143236_m2_2_publishing_functions.
--
-- admin_record_promotion declared a local variable called `id`, which shadows the
-- column of the same name: `where id = p_gathering` raised "column reference id is
-- ambiguous" and every promotion failed. Caught by harness case P63, which is the
-- point of writing the refusal path first — the happy path would have hit it too,
-- but only on a phone.
--
-- The local is renamed `promotion`; nothing else changes.

create or replace function public.admin_record_promotion(
  p_gathering uuid, p_channel text, p_note text, p_actor text
) returns uuid
language plpgsql set search_path = '' as $$
declare
  ch        text := btrim(coalesce(p_channel, ''));
  nt        text := nullif(btrim(coalesce(p_note, '')), '');
  promotion uuid;
begin
  if char_length(ch) < 1 or char_length(ch) > 60 then
    raise exception 'Say where you posted it (up to 60 characters)';
  end if;
  if not exists (
    select 1 from public.gatherings g where g.id = p_gathering and g.published_at is not null
  ) then
    raise exception 'Only a published gathering can be promoted';
  end if;

  -- The same channel, by the same person, within a minute, is a double tap.
  select gp.id into promotion
  from public.gathering_promotions gp
  where gp.gathering_id = p_gathering
    and lower(gp.channel) = lower(ch)
    and gp.promoted_by = p_actor
    and gp.promoted_at > now() - interval '1 minute';
  if promotion is not null then return promotion; end if;

  insert into public.gathering_promotions (gathering_id, channel, note, promoted_by)
  values (p_gathering, ch, nt, p_actor)
  returning gathering_promotions.id into promotion;

  insert into public.moderation_log (actor, action, gathering_id, note)
  values (p_actor, 'promote', p_gathering, ch || coalesce(' — ' || nt, ''));
  return promotion;
end;
$$;
