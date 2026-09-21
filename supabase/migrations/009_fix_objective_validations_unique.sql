-- Task 8: fixes a real schema/RLS mismatch from Task 4, caught only once
-- Task 8's code actually queried this table. objective_hash was declared
-- globally unique, but RLS (migration 007) scopes every row by
-- user_id = auth.uid(). Two different users submitting the exact same
-- objective text would deadlock: the unique constraint blocks the
-- second user's insert, but RLS blocks that user from ever seeing the
-- first user's row to read it back or upsert onto it - permission denied
-- and constraint violation, no way forward for the second user.
--
-- The cache should be per-user (matching every other table's RLS model,
-- SYSTEM-DESIGN-NEXTJS.md §15), not global. Two users asking the same
-- question each get their own cached verdict; only a repeat by the same
-- user is deduplicated.

alter table objective_validations drop constraint objective_validations_objective_hash_key;
create unique index objective_validations_user_hash_key on objective_validations (user_id, objective_hash);
