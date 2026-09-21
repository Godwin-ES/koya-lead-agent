-- Task 4, migration 7 of 7: table grants + Row Level Security.
-- SYSTEM-DESIGN-NEXTJS.md §15 / §16: "RLS on every table, scoped through
-- runs.user_id... The worker uses service_role and is the only writer to
-- tool_calls, agent_events, cost_ledger, and the cache tables."
--
-- Two layers, both required: a bare Postgres GRANT (without it, a query
-- fails with "permission denied for table X" before RLS is ever
-- evaluated - confirmed by tests/integration/schema/rls.test.ts's first
-- red run against these tables), and RLS policies underneath that gate
-- which *rows* a granted role can see. `anon` is granted SELECT on the
-- user-scoped tables deliberately: RLS still returns zero rows for it
-- (auth.uid() is null with no session), which is the correct "logged out"
-- behaviour - an empty result, not a permission error.

grant usage on schema public to anon, authenticated, service_role;

-- service_role bypasses RLS by role attribute (Supabase's own convention)
-- but still needs the base grant to reach these tables at all.
grant select, insert, update, delete on all tables in schema public to service_role;

-- runs: owner can read, create, and update their own runs (start/cancel
-- go through server actions using the user's own session, not
-- service_role - only the worker's *internal* bookkeeping, claim/
-- heartbeat/finalize, needs service_role, and that's enforced by the
-- RPCs in Task 5 being security definer functions, not by this grant).
grant select, insert, update on runs to authenticated;
grant select on runs to anon;
alter table runs enable row level security;

create policy runs_select_own on runs for select
  to authenticated, anon
  using (user_id = auth.uid());

create policy runs_insert_own on runs for insert
  to authenticated
  with check (user_id = auth.uid());

create policy runs_update_own on runs for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- leads: read-only for the owning user. All writes are the worker's
-- (service_role only) - there is no manual lead-editing feature in this
-- project's scope (SYSTEM-DESIGN-NEXTJS.md §20).
grant select on leads to authenticated, anon;
alter table leads enable row level security;

create policy leads_select_own on leads for select
  to authenticated, anon
  using (exists (select 1 from runs where runs.id = leads.run_id and runs.user_id = auth.uid()));

-- outreach_drafts: same shape as leads, one join further (lead -> run).
grant select on outreach_drafts to authenticated, anon;
alter table outreach_drafts enable row level security;

create policy outreach_drafts_select_own on outreach_drafts for select
  to authenticated, anon
  using (
    exists (
      select 1 from leads
      join runs on runs.id = leads.run_id
      where leads.id = outreach_drafts.lead_id and runs.user_id = auth.uid()
    )
  );

-- tool_calls, agent_events, cost_ledger, run_quality_reports: all
-- user-facing (the run timeline, the budget ledger, the quality report -
-- SYSTEM-DESIGN-NEXTJS.md §17.7, §11, §19), all worker-written only.
grant select on tool_calls to authenticated, anon;
alter table tool_calls enable row level security;

create policy tool_calls_select_own on tool_calls for select
  to authenticated, anon
  using (exists (select 1 from runs where runs.id = tool_calls.run_id and runs.user_id = auth.uid()));

grant select on agent_events to authenticated, anon;
alter table agent_events enable row level security;

create policy agent_events_select_own on agent_events for select
  to authenticated, anon
  using (exists (select 1 from runs where runs.id = agent_events.run_id and runs.user_id = auth.uid()));

grant select on cost_ledger to authenticated, anon;
alter table cost_ledger enable row level security;

create policy cost_ledger_select_own on cost_ledger for select
  to authenticated, anon
  using (exists (select 1 from runs where runs.id = cost_ledger.run_id and runs.user_id = auth.uid()));

grant select on run_quality_reports to authenticated, anon;
alter table run_quality_reports enable row level security;

create policy run_quality_reports_select_own on run_quality_reports for select
  to authenticated, anon
  using (exists (select 1 from runs where runs.id = run_quality_reports.run_id and runs.user_id = auth.uid()));

-- system_errors: readable only for errors tied to a run the user owns.
-- Rows with a null run_id (infra-level failures with no owning user) are
-- not exposed to any authenticated/anon request - service_role only.
grant select on system_errors to authenticated, anon;
alter table system_errors enable row level security;

create policy system_errors_select_own on system_errors for select
  to authenticated, anon
  using (
    run_id is not null
    and exists (select 1 from runs where runs.id = system_errors.run_id and runs.user_id = auth.uid())
  );

-- objective_validations: the one table the web app itself writes to
-- directly with the user's own session (SYSTEM-DESIGN-NEXTJS.md §7.1 -
-- validateObjective runs before a run or worker even exists), so unlike
-- every other table above it needs insert/update, not just select.
grant select, insert, update on objective_validations to authenticated;
alter table objective_validations enable row level security;

create policy objective_validations_select_own on objective_validations for select
  to authenticated
  using (user_id = auth.uid());

create policy objective_validations_insert_own on objective_validations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy objective_validations_update_own on objective_validations for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- discovery_cache / scrape_cache: internal implementation detail, shared
-- across users and runs by design (SYSTEM-DESIGN-NEXTJS.md §11). No
-- authenticated or anon access at all - service_role only, and RLS with
-- zero policies for those roles denies everything by default once
-- enabled, which is exactly the intended boundary.
alter table discovery_cache enable row level security;
alter table scrape_cache enable row level security;

comment on policy runs_select_own on runs is 'Ownership root: every other table''s policy ultimately joins back to this one.';
