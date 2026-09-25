-- Human review: decisions on leads, editing and approving drafts, and
-- asking the worker to draft outreach for a lead a reviewer qualified.
--
-- Users still get no direct UPDATE on leads or outreach_drafts. Each
-- review action is a security-definer function that checks the caller owns
-- the run and changes only the columns that action is meant to change -
-- a reviewer can't, say, rewrite a lead's fit reasons or a draft's
-- grounding result.

-- ---------------------------------------------------------------------
-- leads: who decided, and why
-- ---------------------------------------------------------------------
alter table leads add column agent_qualification_status text
  check (agent_qualification_status in ('qualified', 'not_qualified', 'needs_review'));
alter table leads add column decided_by text not null default 'agent' check (decided_by in ('agent', 'reviewer'));
alter table leads add column review_reason text;
alter table leads add column reviewed_at timestamptz;

update leads set agent_qualification_status = qualification_status where agent_qualification_status is null;

create function review_lead(p_lead_id uuid, p_status text, p_reason text) returns leads
language plpgsql security definer set search_path = public as $$
declare l leads;
begin
  if p_status not in ('qualified', 'not_qualified', 'needs_review') then
    raise exception 'invalid status %', p_status using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for a review decision' using errcode = 'check_violation';
  end if;

  select leads.* into l from leads join runs on runs.id = leads.run_id
   where leads.id = p_lead_id and runs.user_id = auth.uid();
  if not found then
    raise exception 'lead not found' using errcode = 'no_data_found';
  end if;

  if p_status = 'qualified' and coalesce(array_length(l.source_urls, 1), 0) = 0 then
    raise exception 'This lead has no source pages - there is no evidence to qualify it on or to draft outreach from.'
      using errcode = 'check_violation';
  end if;

  update leads
     set qualification_status = p_status,
         decided_by = 'reviewer',
         review_reason = trim(p_reason),
         reviewed_at = now(),
         -- The qualified-lead constraint needs at least one fit reason; a
         -- reviewer's qualification carries their own reason as one.
         fit_reasons = case
           when p_status = 'qualified' and coalesce(array_length(fit_reasons, 1), 0) = 0 then array['Reviewer: ' || trim(p_reason)]
           else fit_reasons
         end,
         evidence_gap_reason = case when p_status = 'needs_review' then coalesce(evidence_gap_reason, trim(p_reason)) else evidence_gap_reason end
   where id = p_lead_id
  returning * into l;
  return l;
end;
$$;

-- ---------------------------------------------------------------------
-- outreach_drafts: edits (keeping the agent's version) and approval
-- ---------------------------------------------------------------------
alter table outreach_drafts add column original_subject text;
alter table outreach_drafts add column original_body text;
alter table outreach_drafts add column edited_at timestamptz;
alter table outreach_drafts add column approved_at timestamptz;

create function owned_draft(p_draft_id uuid) returns outreach_drafts
language plpgsql security definer set search_path = public as $$
declare d outreach_drafts;
begin
  select outreach_drafts.* into d from outreach_drafts
    join leads on leads.id = outreach_drafts.lead_id
    join runs on runs.id = leads.run_id
   where outreach_drafts.id = p_draft_id and runs.user_id = auth.uid();
  if not found then
    raise exception 'draft not found' using errcode = 'no_data_found';
  end if;
  return d;
end;
$$;

-- Grounding is computed by the caller (the TypeScript checker) and passed in.
create function edit_draft(p_draft_id uuid, p_subject text, p_body text, p_grounding jsonb, p_flagged boolean) returns outreach_drafts
language plpgsql security definer set search_path = public as $$
declare d outreach_drafts;
begin
  d := owned_draft(p_draft_id);
  if coalesce(trim(p_body), '') = '' then
    raise exception 'the message body cannot be empty' using errcode = 'check_violation';
  end if;

  update outreach_drafts
     set original_subject = case when edited_at is null then subject else original_subject end,
         original_body = case when edited_at is null then body else original_body end,
         subject = case when channel = 'email' then p_subject else null end,
         body = p_body,
         grounding_check = p_grounding,
         flagged_unsupported = p_flagged,
         edited_at = now(),
         approved_at = null
   where id = p_draft_id
  returning * into d;
  return d;
end;
$$;

create function revert_draft(p_draft_id uuid, p_grounding jsonb, p_flagged boolean) returns outreach_drafts
language plpgsql security definer set search_path = public as $$
declare d outreach_drafts;
begin
  d := owned_draft(p_draft_id);
  if d.edited_at is null then
    return d;
  end if;

  update outreach_drafts
     set subject = original_subject,
         body = original_body,
         original_subject = null,
         original_body = null,
         grounding_check = p_grounding,
         flagged_unsupported = p_flagged,
         edited_at = null,
         approved_at = null
   where id = p_draft_id
  returning * into d;
  return d;
end;
$$;

create function set_draft_approval(p_draft_id uuid, p_approved boolean) returns outreach_drafts
language plpgsql security definer set search_path = public as $$
declare d outreach_drafts;
begin
  d := owned_draft(p_draft_id);
  update outreach_drafts set approved_at = case when p_approved then now() else null end
   where id = p_draft_id
  returning * into d;
  return d;
end;
$$;

-- ---------------------------------------------------------------------
-- draft_requests: "draft outreach" for a lead, picked up by the worker
-- ---------------------------------------------------------------------
create table draft_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  -- Same rule as runs.replay_mode (migration 019): only a worker in the same mode claims it.
  replay_mode boolean not null default true,
  error text,
  worker_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- One active request per lead - a second click can't queue a second session.
create unique index draft_requests_one_active_per_lead on draft_requests (lead_id) where status in ('queued', 'running');
create index draft_requests_queue_idx on draft_requests (status, created_at);

grant select on draft_requests to authenticated;
alter table draft_requests enable row level security;
create policy draft_requests_select_own on draft_requests for select
  to authenticated
  using (exists (select 1 from runs where runs.id = draft_requests.run_id and runs.user_id = auth.uid()));

create function request_drafts(p_lead_id uuid, p_replay_mode boolean) returns draft_requests
language plpgsql security definer set search_path = public as $$
declare l leads; r draft_requests;
begin
  select leads.* into l from leads join runs on runs.id = leads.run_id
   where leads.id = p_lead_id and runs.user_id = auth.uid();
  if not found then
    raise exception 'lead not found' using errcode = 'no_data_found';
  end if;
  if l.qualification_status <> 'qualified' then
    raise exception 'Outreach is only drafted for qualified leads.' using errcode = 'check_violation';
  end if;

  select * into r from draft_requests where lead_id = p_lead_id and status in ('queued', 'running');
  if found then
    return r;
  end if;

  insert into draft_requests (run_id, lead_id, replay_mode) values (l.run_id, l.id, p_replay_mode)
  returning * into r;
  return r;
end;
$$;

create function claim_next_draft_request(p_worker_id text, p_replay_mode boolean default null) returns draft_requests
language plpgsql security definer set search_path = public as $$
declare r draft_requests;
begin
  select * into r from draft_requests
   where status = 'queued'
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

revoke execute on function review_lead(uuid, text, text) from public;
revoke execute on function owned_draft(uuid) from public;
revoke execute on function edit_draft(uuid, text, text, jsonb, boolean) from public;
revoke execute on function revert_draft(uuid, jsonb, boolean) from public;
revoke execute on function set_draft_approval(uuid, boolean) from public;
revoke execute on function request_drafts(uuid, boolean) from public;
revoke execute on function claim_next_draft_request(text, boolean) from public;

grant execute on function review_lead(uuid, text, text) to authenticated;
grant execute on function edit_draft(uuid, text, text, jsonb, boolean) to authenticated;
grant execute on function revert_draft(uuid, jsonb, boolean) to authenticated;
grant execute on function set_draft_approval(uuid, boolean) to authenticated;
grant execute on function request_drafts(uuid, boolean) to authenticated;
grant execute on function claim_next_draft_request(text, boolean) to service_role;
