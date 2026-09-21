-- Phase 3 M3.1 — the city label on W1 says where this is, from the row rather than
-- from the page (Alex).
--
-- "Toronto, Canada", top centre and quiet, with the country's flag beside it. The
-- point of putting it on the `cities` row is that **Vancouver, Montreal and Calgary
-- are new rows later, not code changes** — the same reason the search radius, the
-- publishing target and the timezone already live there and never in code
-- (decisions Part 5, "Ticketmaster import area": another city is data, not a rebuild).
--
-- Two columns, because a label and a flag are different questions:
--   `country`       what the page says — "Canada". Copy, and translatable later.
--   `country_code`  ISO 3166-1 alpha-2, which is what picks the flag. An identifier,
--                   never shown.
--
-- **The flag is an inline SVG, not an emoji** (Alex). A flag emoji renders as the
-- letters "CA" on Windows, which is the majority of the desktop readers a Reddit link
-- reaches — and inline keeps the own-origin rule, which a flag-image CDN would break
-- for the sake of sixteen pixels.

alter table public.cities
  add column country text not null default 'Canada',
  add column country_code text not null default 'CA' check (country_code ~ '^[A-Z]{2}$');

comment on column public.cities.country is
  'What the city label says after the comma. Copy, so it changes here rather than in a page.';
comment on column public.cities.country_code is
  'ISO 3166-1 alpha-2, and only ever used to pick the inline flag. Never shown.';

-- The defaults exist so the one row that exists is right; a second city sets both
-- explicitly. They stay as defaults rather than being dropped, because a city row
-- created without a country would otherwise render a label with a gap in it.
update public.cities set country = 'Canada', country_code = 'CA' where slug = 'toronto';
