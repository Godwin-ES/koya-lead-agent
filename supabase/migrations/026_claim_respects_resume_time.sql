-- A run the worker resumes on its own after a temporary failure (a
-- provider overloaded, rate-limited or unreachable) goes back in the queue
-- with queued_at set a few minutes ahead. claim_next_run skips it until
-- then, so the retry waits instead of hitting the same outage straight
-- away. Same signature as migration 019, so CREATE OR REPLACE is safe.
create or replace function claim_next_run(p_worker_id text, p_replay_mode boolean default null) returns runs
language plpgsql security definer as $$
declare r runs;
begin
  select * into r from runs
   where status = 'queued'
     and (p_replay_mode is null or replay_mode = p_replay_mode)
     and coalesce(queued_at, created_at) <= now()
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
