-- Delete a run and everything saved for it. Every run-owned table already
-- cascades from runs: leads (and their outreach_drafts), tool_calls,
-- agent_events, cost_ledger, run_quality_reports and draft_requests.
-- system_errors keeps its rows with run_id set null (migration 006). The
-- shared caches (discovery_cache, scrape_cache, objective_validations)
-- aren't owned by a run and stay.
--
-- Refused while a worker is executing the run or drafting for one of its
-- leads. The run row is locked first, so claim_next_run (FOR UPDATE SKIP
-- LOCKED) can't pick up a queued run halfway through its deletion; a run a
-- worker claimed a moment earlier is already 'running' and is refused.
create function delete_run(p_run_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r runs;
begin
  select * into r from runs where id = p_run_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;

  if r.status = 'running' then
    raise exception 'This run is running. Pause or cancel it, then delete it once it has stopped.'
      using errcode = 'check_violation';
  end if;

  -- Lock its draft requests too, so a queued one can't be claimed mid-delete.
  perform 1 from draft_requests where run_id = p_run_id for update;
  if exists (select 1 from draft_requests where run_id = p_run_id and status = 'running') then
    raise exception 'Outreach is being drafted for a lead in this run. Delete it once drafting finishes.'
      using errcode = 'check_violation';
  end if;

  delete from runs where id = p_run_id;
end;
$$;

revoke execute on function delete_run(uuid) from public;
grant execute on function delete_run(uuid) to authenticated;
