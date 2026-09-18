-- Phase 1 M1.2 — privileges for the new tables and the public venue-maps bucket
-- (docs/visibility.md V11, V12).
--
-- Supabase grants anon and authenticated every privilege on NEW tables by default,
-- so each new table is revoked explicitly. Admin-only tables get nothing back: the
-- service key (admin, importers) is the only thing that reads or writes them.

revoke all on public.cities, public.venue_external_ids, public.venue_aliases,
              public.spot_suggestions, public.gathering_sources, public.gathering_triage,
              public.moderation_log
  from anon, authenticated;

-- Cities are public reference data, like neighbourhoods.
grant select on public.cities to anon, authenticated;

create policy cities_read on public.cities
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- venue-maps: PUBLIC bucket (decisions Part 5). A map shows a public building and its
-- public meeting spots — the same facts already public in venues and meeting_spots —
-- never a person (H1). Public URLs let Cloudflare cache the image for fast crowd
-- pages. Pin photos stay in the private photos bucket (V6).
--
-- No storage policies for anon or authenticated: visitors cannot upload, replace,
-- delete or list. Only the service key (admin upload form) writes here.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('venue-maps', 'venue-maps', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
