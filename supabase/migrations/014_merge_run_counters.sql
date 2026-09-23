-- Real bug, found live: every `counters` writer (bumpToolCallsUsed,
-- discover_companies, scrape_site) read a local, in-process snapshot of
-- `run.counters`, merged its own one field into that snapshot in JS, and
-- wrote the whole object back with a plain `.update({counters: ...})` -
-- which replaces the entire JSONB column, not a merge. Because
-- bumpToolCallsUsed always runs immediately after a handler's own write
-- (inside the same invoke() call, on a snapshot taken *before* the
-- handler ran), its write reliably clobbered whatever field the handler
-- had just written a moment earlier - candidates_seen and scrapes_used
-- were being wiped after almost every single tool call, which is why
-- gate()'s candidate_limit/scrape_limit checks never actually fired in a
-- real run despite being individually correct in isolation.
--
-- merge_run_counters does the merge atomically, in the database, so no
-- caller's local snapshot can ever stomp a field it doesn't know about -
-- this closes the whole bug class, not just today's two known fields.
create function merge_run_counters(p_run_id uuid, p_patch jsonb) returns runs
language plpgsql security definer as $$
declare r runs;
begin
  update runs
     set counters = coalesce(counters, '{}'::jsonb) || p_patch
   where id = p_run_id
  returning * into r;

  if not found then
    raise exception 'run % not found', p_run_id;
  end if;

  return r;
end;
$$;

revoke execute on function merge_run_counters(uuid, jsonb) from public;
grant execute on function merge_run_counters(uuid, jsonb) to service_role;
