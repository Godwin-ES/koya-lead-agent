-- Pause/resume. A queued run is paused directly; a running one gets
-- pause_requested_at, which the worker checks between steps (never mid-
-- step), then sets status 'paused' and releases the run. Resume puts it
-- back in the queue, and the next worker continues it from a handover
-- note built from the run's saved work.
alter table runs drop constraint runs_status_check;
alter table runs add constraint runs_status_check check (
  status in ('draft', 'queued', 'running', 'awaiting_input', 'paused', 'completed', 'partial', 'failed', 'cancelled')
);

alter table runs add column pause_requested_at timestamptz;
