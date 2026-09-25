-- A worker only claims runs made for its own mode. Integration and E2E
-- test runs are replay runs; a developer's live worker (REPLAY_MODE=false)
-- used to claim them from the shared queue and run them live - real
-- Apify/model calls, and recordings written over committed test fixtures
-- (seen on 2026-09-23 and 2026-09-25). A replay worker likewise never
-- touches a real run.
--
-- Drop-and-create, not CREATE OR REPLACE: adding a parameter changes the
-- function's identity, and replacing would leave the old one-argument
-- overload behind (the same trap migration 016 fixed for record_tool_call).
drop function claim_next_run(text);

create function claim_next_run(p_worker_id text, p_replay_mode boolean default null) returns runs
language plpgsql security definer as $$
declare r runs;
begin
  select * into r from runs
   where status = 'queued'
     and (p_replay_mode is null or replay_mode = p_replay_mode)
   order by queued_at
   for update skip locked
   limit 1;

  if not found then
    return null;
  end if;

  update runs
     set status = 'running',
         worker_id = p_worker_id,
         heartbeat_at = now(),
         started_at = coalesce(started_at, now())
   where id = r.id
  returning * into r;

  return r;
end;
$$;

revoke execute on function claim_next_run(text, boolean) from public;
grant execute on function claim_next_run(text, boolean) to service_role;
