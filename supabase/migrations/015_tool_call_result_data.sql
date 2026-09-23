-- Every tool handler already computes a rich `data` payload (the
-- discovered candidates, the scraped page, the saved lead's qualification
-- reasoning, the draft text, the ICP, ...) - invoke() was just never
-- persisting it, only the one-line `result_summary`. This is what makes
-- clicking a timeline row for real detail possible without inventing new
-- data collection: the data already existed, it just never left memory.

alter table tool_calls add column result_data jsonb;

-- Adding a trailing optional parameter to record_tool_call is a
-- backward-compatible signature extension (existing callers that don't
-- pass p_result_data are unaffected) - re-grants below just in case.
create or replace function record_tool_call(
  p_run_id uuid,
  p_tool_name text,
  p_status text,
  purpose text default null,
  input_summary text default null,
  result_summary text default null,
  error_message text default null,
  denial_reason text default null,
  duration_ms int default null,
  estimated_cost_usd numeric default null,
  p_result_data jsonb default null
) returns tool_calls
language plpgsql security definer as $$
declare v_seq int; v_row tool_calls;
begin
  perform pg_advisory_xact_lock(hashtext(p_run_id::text));

  select coalesce(max(seq), 0) + 1 into v_seq from tool_calls where run_id = p_run_id;

  insert into tool_calls (
    run_id, seq, tool_name, purpose, input_summary, result_summary,
    status, error_message, denial_reason, duration_ms, estimated_cost_usd,
    result_data
  ) values (
    p_run_id, v_seq, p_tool_name, purpose, input_summary, result_summary,
    p_status, error_message, denial_reason, duration_ms, estimated_cost_usd,
    p_result_data
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function record_tool_call(uuid, text, text, text, text, text, text, text, int, numeric, jsonb) from public;
grant execute on function record_tool_call(uuid, text, text, text, text, text, text, text, int, numeric, jsonb) to service_role;
