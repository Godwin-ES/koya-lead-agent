-- Task 4, migration 6 of 7: `run_quality_reports`, `system_errors`, and the
-- trigger that refuses to mark a run `completed` without a quality report
-- already on file. SYSTEM-DESIGN-NEXTJS.md §16.

create table run_quality_reports (
  run_id uuid primary key references runs (id) on delete cascade,
  checks jsonb not null,
  scorecard jsonb not null,
  passed boolean not null,
  summary text not null,
  created_at timestamptz not null default now()
);

-- Nullable run_id: some failures (a worker boot failure, a credential
-- check failing before any run is claimed) aren't tied to any one run.
create table system_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs (id) on delete set null,
  phase text,
  tool_name text,
  provider text,
  message text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index system_errors_run_id_idx on system_errors (run_id);

create function check_completed_requires_quality_report() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and not exists (select 1 from run_quality_reports where run_id = new.id) then
    raise exception 'completed_requires_quality_report: run % has no quality report', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger runs_completed_requires_quality_report
  before insert or update on runs
  for each row execute function check_completed_requires_quality_report();

comment on table run_quality_reports is 'One row per finished run, written by finalize_run (Task 5). A run cannot become completed without one - see the trigger above.';
comment on table system_errors is 'Unexpected system failures (participant guide: detect, surface clearly, make it possible to tell what failed and why). Routine business validation is not logged here.';
