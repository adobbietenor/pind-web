-- Phase 1 M1.2 — gatherings can come from the weekly AI discovery run (decisions.md
-- Part 5, "Gathering sourcing"). On its own because Postgres will not let a newly
-- added enum value be used in the transaction that adds it.

alter type public.gathering_source add value if not exists 'ai';
