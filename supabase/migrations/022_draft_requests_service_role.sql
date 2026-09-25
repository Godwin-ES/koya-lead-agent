-- Migration 007 granted service_role access to every table that existed
-- then ("on all tables in schema public") - a one-time grant, not a
-- default for tables created later. draft_requests (migration 020) is the
-- first new table since, so the worker couldn't insert or update it
-- ("permission denied for table draft_requests"), which would have left
-- every drafting request stuck.
grant select, insert, update, delete on draft_requests to service_role;
