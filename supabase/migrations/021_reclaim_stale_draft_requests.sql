-- A draft request left 'running' by a worker that died mid-session would
-- otherwise show "Drafting..." forever. Drafting sessions are short (a few
-- model turns), so one still running after 15 minutes is treated as
-- abandoned and can be claimed again. Same signature, so this replaces
-- migration 020's function rather than adding an overload.
create or replace function claim_next_draft_request(p_worker_id text, p_replay_mode boolean default null) returns draft_requests
language plpgsql security definer set search_path = public as $$
declare r draft_requests;
begin
  select * into r from draft_requests
   where (status = 'queued' or (status = 'running' and started_at < now() - interval '15 minutes'))
     and (p_replay_mode is null or replay_mode = p_replay_mode)
   order by created_at
   for update skip locked
   limit 1;
  if not found then
    return null;
  end if;

  update draft_requests set status = 'running', worker_id = p_worker_id, started_at = now()
   where id = r.id
  returning * into r;
  return r;
end;
$$;
