-- M3.2b — person_interests loses updated_at (10 Oct 2026).
--
-- Nothing set it on a change: the app writes `categories` alone (an update, or an
-- insert the first time), so the column would only ever have said when the row was
-- made, under a name that says otherwise (memory: never let a field carry a meaning it
-- does not have). Nothing reads it. Dropped rather than kept by a trigger nobody needs.

alter table public.person_interests drop column updated_at;
