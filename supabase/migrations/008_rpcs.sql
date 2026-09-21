-- Task 5: the transactional RPCs. SYSTEM-DESIGN-NEXTJS.md §5 (why
-- Supabase-as-queue works: FOR UPDATE SKIP LOCKED), §6 (the run lifecycle
-- rules these functions implement), §16 (RPC list).

-- ---------------------------------------------------------------------
-- claim_next_run: only path into `running`. FOR UPDATE SKIP LOCKED means
-- two workers racing for the same queue never both win the same run - the
-- second worker's SELECT simply skips the row the first one locked and
-- moves on to the next candidate (or finds none).
-- ---------------------------------------------------------------------
create function claim_next_run(p_worker_id text) returns runs
language plpgsql security definer as $$
declare r runs;
begin
  select * into r from runs
   where status = 'queued'
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

-- ---------------------------------------------------------------------
-- heartbeat: refreshes heartbeat_at for the owning worker only, and
-- reports back whether it actually took - a false return tells the
-- worker its run was reclaimed out from under it (wrong worker_id, or the
-- run moved on), so it should stop rather than keep working on a run it
-- no longer owns.
-- ---------------------------------------------------------------------
create function heartbeat(p_run_id uuid, p_worker_id text) returns boolean
language plpgsql security definer as $$
declare v_updated int;
begin
  update runs
     set heartbeat_at = now()
   where id = p_run_id
     and worker_id = p_worker_id
     and status = 'running';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ---------------------------------------------------------------------
-- reclaim_stale_runs: a running run whose heartbeat is older than 90s
-- either goes back to queued with attempt+1, or - once attempt is
-- already at 3 - fails outright. Returns the ids it touched, for logging
-- and for tests.
-- ---------------------------------------------------------------------
create function reclaim_stale_runs() returns uuid[]
language plpgsql security definer as $$
declare v_reclaimed uuid[];
begin
  with stale as (
    select id from runs
     where status = 'running'
       and heartbeat_at < now() - interval '90 seconds'
     for update skip locked
  ),
  failed as (
    update runs set
      status = 'failed',
      failure_reason = 'Worker heartbeat lost after 3 attempts'
    from stale
    where runs.id = stale.id and runs.attempt >= 3
    returning runs.id
  ),
  requeued as (
    update runs set
      status = 'queued',
      attempt = runs.attempt + 1,
      worker_id = null,
      heartbeat_at = null,
      queued_at = now()
    from stale
    where runs.id = stale.id and runs.attempt < 3
    returning runs.id
  )
  select array_agg(id) into v_reclaimed from (
    select id from failed
    union all
    select id from requeued
  ) touched;

  return coalesce(v_reclaimed, array[]::uuid[]);
end;
$$;

-- ---------------------------------------------------------------------
-- record_tool_call: allocates seq atomically per run via a transaction-
-- scoped advisory lock (auto-released at commit), so concurrent tool
-- calls on the same run never collide, while calls on different runs
-- never block each other.
-- ---------------------------------------------------------------------
create function record_tool_call(
  p_run_id uuid,
  p_tool_name text,
  p_status text,
  purpose text default null,
  input_summary text default null,
  result_summary text default null,
  error_message text default null,
  denial_reason text default null,
  duration_ms int default null,
  estimated_cost_usd numeric default null
) returns tool_calls
language plpgsql security definer as $$
declare v_seq int; v_row tool_calls;
begin
  perform pg_advisory_xact_lock(hashtext(p_run_id::text));

  select coalesce(max(seq), 0) + 1 into v_seq from tool_calls where run_id = p_run_id;

  insert into tool_calls (
    run_id, seq, tool_name, purpose, input_summary, result_summary,
    status, error_message, denial_reason, duration_ms, estimated_cost_usd
  ) values (
    p_run_id, v_seq, p_tool_name, purpose, input_summary, result_summary,
    p_status, error_message, denial_reason, duration_ms, estimated_cost_usd
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- append_agent_event: same seq-allocation pattern as record_tool_call,
-- against its own independent per-run sequence.
-- ---------------------------------------------------------------------
create function append_agent_event(p_run_id uuid, p_type text, p_payload jsonb default null) returns agent_events
language plpgsql security definer as $$
declare v_seq int; v_row agent_events;
begin
  perform pg_advisory_xact_lock(hashtext(p_run_id::text || ':events'));

  select coalesce(max(seq), 0) + 1 into v_seq from agent_events where run_id = p_run_id;

  insert into agent_events (run_id, seq, type, payload)
  values (p_run_id, v_seq, p_type, p_payload)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- finalize_run: the transactional half of finishing a run. The quality
-- report's actual check/scorecard *content* is computed by Task 19's
-- quality module and passed in here; this function's job is to persist
-- it (upsert, so a rerun updates the same row rather than duplicating)
-- and atomically decide completed vs partial from the *live* qualified
-- count - never from a value the caller might be passing stale.
-- ---------------------------------------------------------------------
create function finalize_run(
  p_run_id uuid,
  p_checks jsonb,
  p_scorecard jsonb,
  p_passed boolean,
  p_summary text
) returns runs
language plpgsql security definer as $$
declare
  v_qualified_count int;
  v_target int;
  v_row runs;
begin
  select count(*) into v_qualified_count from leads
   where run_id = p_run_id and qualification_status = 'qualified';

  select coalesce((limits->>'target_qualified')::int, 10) into v_target from runs where id = p_run_id;

  insert into run_quality_reports (run_id, checks, scorecard, passed, summary)
  values (p_run_id, p_checks, p_scorecard, p_passed, p_summary)
  on conflict (run_id) do update set
    checks = excluded.checks,
    scorecard = excluded.scorecard,
    passed = excluded.passed,
    summary = excluded.summary;

  if v_qualified_count >= v_target then
    update runs set
      status = 'completed',
      finished_at = coalesce(finished_at, now()),
      partial_reason = null
     where id = p_run_id
    returning * into v_row;
  else
    update runs set
      status = 'partial',
      finished_at = coalesce(finished_at, now()),
      partial_reason = format('Found %s of %s qualified leads within budget: %s', v_qualified_count, v_target, p_summary)
     where id = p_run_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- run_summary: the read-only, uncounted status check behind the
-- list_run_state tool (Task 12) - live counts from leads, cheap enough
-- the agent can check its own progress without spending a budgeted call.
-- ---------------------------------------------------------------------
create function run_summary(p_run_id uuid) returns jsonb
language sql stable security definer as $$
  select jsonb_build_object(
    'status', r.status,
    'limits', r.limits,
    'counters', r.counters,
    'qualified_count', (select count(*) from leads where run_id = p_run_id and qualification_status = 'qualified'),
    'needs_review_count', (select count(*) from leads where run_id = p_run_id and qualification_status = 'needs_review'),
    'not_qualified_count', (select count(*) from leads where run_id = p_run_id and qualification_status = 'not_qualified'),
    'tool_call_count', (select count(*) from tool_calls where run_id = p_run_id)
  )
  from runs r
  where r.id = p_run_id;
$$;

-- Worker-only entry points: revoke the broad execute grant Postgres gives
-- PUBLIC by default, then grant explicitly to service_role. anon and
-- authenticated never call these directly - the worker (service_role) is
-- the only caller.
revoke execute on function claim_next_run(text) from public;
revoke execute on function heartbeat(uuid, text) from public;
revoke execute on function reclaim_stale_runs() from public;
revoke execute on function record_tool_call(uuid, text, text, text, text, text, text, text, int, numeric) from public;
revoke execute on function append_agent_event(uuid, text, jsonb) from public;
revoke execute on function finalize_run(uuid, jsonb, jsonb, boolean, text) from public;
revoke execute on function run_summary(uuid) from public;

grant execute on function claim_next_run(text) to service_role;
grant execute on function heartbeat(uuid, text) to service_role;
grant execute on function reclaim_stale_runs() to service_role;
grant execute on function record_tool_call(uuid, text, text, text, text, text, text, text, int, numeric) to service_role;
grant execute on function append_agent_event(uuid, text, jsonb) to service_role;
grant execute on function finalize_run(uuid, jsonb, jsonb, boolean, text) to service_role;
grant execute on function run_summary(uuid) to service_role;
