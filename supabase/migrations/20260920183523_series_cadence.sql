-- Fortnightly and monthly, alongside weekly (Alex, before the wider research pass).
--
-- Still a generator and still no recurrence in the schema: a crew meets on a night,
-- not on a series, so the dated rows have to exist whatever model sits above them.
-- This only widens what one form can type out.
--
-- Monthly is the one that needs a decision, because community gatherings say "last
-- Sunday" or "second Tuesday", never "the 27th". So the cadence is read off the first
-- date: which weekday it is, and which of that weekday it is in its month. A date in
-- the last seven days of its month is treated as **last**, not as the fourth — that
-- is what Pedestrian Sundays means by "last Sunday of the month", and a fourth-Sunday
-- reading would put it a week early in any five-Sunday month.

create type public.series_cadence as enum ('weekly', 'fortnightly', 'monthly');

drop function public.admin_create_weekly_series(jsonb, date, text);

create function public.admin_create_series(
  p_template jsonb,
  p_until    date,
  p_cadence  public.series_cadence,
  p_actor    text
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  first_start timestamptz;
  tz          text;
  ids         uuid[] := '{}';
  new_id      uuid;
  at          timestamptz;
  local_first date;
  local_next  date;
  ends_gap    interval;
  n           integer := 0;
  clock       time;
  dow         integer;
  nth         integer;
  from_end    boolean;
  month_start date;
begin
  first_start := (p_template ->> 'starts_at')::timestamptz;
  if first_start is null then raise exception 'A series needs a first date'; end if;
  if p_until is null then raise exception 'A series needs a date to repeat until'; end if;

  select c.timezone into tz
  from public.venues v join public.cities c on c.slug = v.city
  where v.id = (p_template ->> 'venue_id')::uuid;
  tz := coalesce(tz, 'America/Toronto');

  local_first := (first_start at time zone tz)::date;
  clock       := (first_start at time zone tz)::time;

  if p_until > local_first + 400 then
    raise exception 'That repeats for more than a year. Enter a nearer end date.';
  end if;

  ends_gap := case
    when p_template ? 'ends_at' and (p_template ->> 'ends_at') is not null
    then (p_template ->> 'ends_at')::timestamptz - first_start
  end;

  -- Monthly: the weekday, and which one of it. "Last" wins over "fourth" whenever
  -- there is no fifth, because that is what people mean.
  dow      := extract(dow from local_first)::integer;
  nth      := ((extract(day from local_first)::integer - 1) / 7) + 1;
  from_end := (local_first + 7) > (date_trunc('month', local_first) + interval '1 month' - interval '1 day')::date;

  local_next := local_first;
  while local_next <= p_until loop
    at := (local_next + clock) at time zone tz;
    insert into public.gatherings (
      name, starts_at, ends_at, venue_id, venue_name_raw, event_url,
      entry, door_price_cents, entry_note, category, featured, source
    ) values (
      p_template ->> 'name',
      at,
      case when ends_gap is not null then at + ends_gap end,
      (p_template ->> 'venue_id')::uuid,
      p_template ->> 'venue_name_raw',
      p_template ->> 'event_url',
      coalesce((p_template ->> 'entry')::public.entry_kind, 'ticketed'),
      (p_template ->> 'door_price_cents')::integer,
      p_template ->> 'entry_note',
      (p_template ->> 'category')::public.gathering_category,
      coalesce((p_template ->> 'featured')::boolean, false),
      'manual'
    )
    returning id into new_id;

    ids := ids || new_id;
    n := n + 1;

    -- The next date, in the venue's own calendar. Adding days locally and converting
    -- back is what keeps an 8am run club at 8am across the daylight-saving change.
    if p_cadence = 'weekly' then
      local_next := local_next + 7;
    elsif p_cadence = 'fortnightly' then
      local_next := local_next + 14;
    else
      month_start := (date_trunc('month', local_next) + interval '1 month')::date;
      if from_end then
        -- The last <dow> of the following month.
        local_next := (date_trunc('month', month_start) + interval '1 month' - interval '1 day')::date;
        local_next := local_next - ((extract(dow from local_next)::integer - dow + 7) % 7);
      else
        -- The nth <dow>: step to the first one, then add whole weeks.
        local_next := month_start + ((dow - extract(dow from month_start)::integer + 7) % 7);
        local_next := local_next + 7 * (nth - 1);
        -- A month with only four of that weekday takes the fourth.
        if extract(month from local_next) <> extract(month from month_start) then
          local_next := local_next - 7;
        end if;
      end if;
    end if;
  end loop;

  if n = 0 then raise exception 'That end date is before the first gathering'; end if;

  insert into public.moderation_log (actor, action, note)
  values (p_actor, 'series_create', format('%s — %s drafts, %s until %s', p_template ->> 'name', n, p_cadence, p_until));

  return jsonb_build_object('created', n, 'ids', to_jsonb(ids));
end;
$$;

revoke execute on function public.admin_create_series(jsonb, date, public.series_cadence, text) from public, anon, authenticated;
grant execute on function public.admin_create_series(jsonb, date, public.series_cadence, text) to service_role;
