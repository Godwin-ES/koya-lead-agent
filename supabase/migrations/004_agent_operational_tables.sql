-- Task 4, migration 4 of 7: `tool_calls`, `agent_events`, `cost_ledger` -
-- the tool-call evidence artifact and the live budget ledger
-- (SYSTEM-DESIGN-NEXTJS.md §16, §17.7, §11).

create table tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id) on delete cascade,
  seq int not null,

  tool_name text not null,
  purpose text,
  input_summary text,
  result_summary text,

  status text not null check (status in ('ok', 'error', 'denied', 'cache_hit')),
  error_message text,
  denial_reason text,

  duration_ms int,
  estimated_cost_usd numeric(10, 4),

  created_at timestamptz not null default now(),

  unique (run_id, seq)
);

create index tool_calls_run_id_idx on tool_calls (run_id);

create table agent_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id) on delete cascade,
  seq int not null,

  type text not null check (
    type in ('phase', 'assistant_text', 'tool_use', 'tool_result', 'skill_load', 'limit_hit', 'injection_flag', 'system')
  ),
  payload jsonb,

  created_at timestamptz not null default now(),

  unique (run_id, seq)
);

create index agent_events_run_id_idx on agent_events (run_id);

create table cost_ledger (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id) on delete cascade,

  provider text not null check (provider in ('apify', 'firecrawl', 'anthropic', 'google')),
  unit_type text not null,
  units numeric not null,
  estimated_cost_usd numeric(10, 4) not null,
  model text,
  ref text,

  created_at timestamptz not null default now()
);

create index cost_ledger_run_id_idx on cost_ledger (run_id);

comment on table tool_calls is 'Append-only tool-call log. This is the tool-call evidence deliverable, not just internal logging (SYSTEM-DESIGN-NEXTJS.md §17.7).';
comment on table agent_events is 'Powers the live run timeline (SYSTEM-DESIGN-NEXTJS.md §17.7).';
comment on table cost_ledger is 'Every billable unit, Apify/Firecrawl/model. estimated_cost_usd - see app/docs/provider-findings.md on why Agent SDK cost fields are estimates, not billing truth.';
