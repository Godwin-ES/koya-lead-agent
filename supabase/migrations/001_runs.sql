-- Task 4, migration 1 of 7: extensions + the `runs` table.
-- SYSTEM-DESIGN-NEXTJS.md §16 (`runs`) and §6 (the 8-state lifecycle).

create extension if not exists pgcrypto;

create table runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  objective_raw text not null,
  icp jsonb,

  status text not null default 'draft' check (
    status in ('draft', 'queued', 'running', 'awaiting_input', 'completed', 'partial', 'failed', 'cancelled')
  ),

  runner text check (runner in ('gemini', 'agent-sdk')),
  model text,
  scraper text check (scraper in ('crawl4ai', 'firecrawl')),
  replay_mode boolean not null default true,
  fixture_set text,

  -- SYSTEM-DESIGN-NEXTJS.md §7's intake defaults; shape mirrors
  -- packages/core/src/domain/types.ts RunLimits / RunCounters exactly.
  limits jsonb not null default '{}'::jsonb,
  counters jsonb not null default '{}'::jsonb,

  -- §6's clarification flow: at most one round trip per run.
  clarification_question text,
  clarification_answer text,
  clarification_count int not null default 0,

  -- §7.1/§7.2's objective validation gate.
  validation_verdict text check (
    validation_verdict in (
      'valid', 'vague', 'incoherent', 'not_a_request', 'out_of_scope', 'out_of_scope_unsafe', 'unavailable'
    )
  ),
  validation_reason text,
  validation_confidence numeric(3, 2) check (validation_confidence is null or (validation_confidence between 0 and 1)),
  validation_missing_criteria text[],
  validation_dismissed_at timestamptz,

  failure_reason text,
  partial_reason text,

  -- §5's claim/heartbeat/reclaim worker lifecycle (RPCs land in Task 5).
  worker_id text,
  heartbeat_at timestamptz,
  attempt int not null default 0,

  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index runs_user_id_idx on runs (user_id);
create index runs_status_idx on runs (status);

comment on table runs is 'One row per lead-research run. Ownership root for every other table (SYSTEM-DESIGN-NEXTJS.md §16).';
