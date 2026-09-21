-- Task 9: server-side defense-in-depth against a duplicate run creation
-- (SYSTEM-DESIGN-NEXTJS.md §17.4: "the server action carries a
-- client-generated idempotency key, so a duplicate that slips through
-- ... is a no-op"). ActionButton (Task 6) already generates a stable
-- per-intent key client-side; runs had nowhere to check it against.
alter table runs add column idempotency_key text;
create unique index runs_user_idempotency_key on runs (user_id, idempotency_key) where idempotency_key is not null;
