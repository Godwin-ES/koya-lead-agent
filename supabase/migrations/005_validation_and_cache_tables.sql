-- Task 4, migration 5 of 7: `objective_validations` (the intake classifier
-- cache and dismissal-rate dataset) plus `discovery_cache` and
-- `scrape_cache` (SYSTEM-DESIGN-NEXTJS.md §16, §7.3, §11).

create table objective_validations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  objective_hash text not null unique,
  objective_raw text not null,

  verdict text not null check (
    verdict in ('valid', 'vague', 'incoherent', 'not_a_request', 'out_of_scope', 'out_of_scope_unsafe', 'unavailable')
  ),
  confidence numeric(3, 2) check (confidence is null or (confidence between 0 and 1)),
  reason text,
  missing_criteria text[],
  suggested_rewrite text,
  model text,

  dismissed boolean not null default false,

  created_at timestamptz not null default now()
);

create index objective_validations_user_id_idx on objective_validations (user_id);

-- Shared, not user-scoped or run-scoped by design (SYSTEM-DESIGN-NEXTJS.md
-- §11 "Caching"): a repeated objective or a repeated URL costs $0
-- regardless of who's asking.
create table discovery_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  actor_id text,
  input_json jsonb,
  results jsonb,
  item_count int,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table scrape_cache (
  id uuid primary key default gen_random_uuid(),
  url_hash text not null unique,
  url text not null,
  scraper text not null check (scraper in ('crawl4ai', 'firecrawl')),
  title text,
  content_md text,
  http_status int,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz
);

create index discovery_cache_expires_at_idx on discovery_cache (expires_at);
create index scrape_cache_expires_at_idx on scrape_cache (expires_at);

comment on table objective_validations is 'Intake classifier cache (by objective_hash) and dismissal-rate dataset (SYSTEM-DESIGN-NEXTJS.md §7.3).';
