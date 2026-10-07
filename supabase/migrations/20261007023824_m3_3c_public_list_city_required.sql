-- M3.3c — the public list without a city is gone (6 Oct 2026). The deployed W1 passes
-- the city since the last deploy (checked live: the list read through the city version),
-- so the two-argument public_gatherings, which returned every city, is dropped: a caller
-- that forgets the city now gets an error, not every city's gatherings.

drop function public.public_gatherings(timestamptz, timestamptz);
