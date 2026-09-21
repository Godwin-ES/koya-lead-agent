-- Task 4, migration 2 of 7: the `leads` table, its evidence and confidence
-- CHECK constraints, and the domain-normalization trigger.
-- SYSTEM-DESIGN-NEXTJS.md §16 (`leads`) and §14 (idempotency: duplicate
-- prevention is a constraint, not a prompt instruction).

-- Mirrors packages/core/src/domain/normalize.ts's normalizeDomain()
-- exactly (lowercase, strip protocol, strip path/query/fragment, strip
-- port, strip a leading "www." label only) so the database and the
-- application agree on the canonical form - this is the layer that
-- actually holds even if a caller writes straight to the table.
create function normalize_company_domain(input text) returns text
language plpgsql immutable as $$
declare
  value text := lower(trim(input));
begin
  value := regexp_replace(value, '^[a-z][a-z0-9+.-]*://', '');
  value := split_part(value, '/', 1);
  value := split_part(value, '?', 1);
  value := split_part(value, '#', 1);
  value := regexp_replace(value, ':\d+$', '');
  value := regexp_replace(value, '^www\.', '');
  return value;
end;
$$;

create function set_leads_company_domain_normalized() returns trigger
language plpgsql as $$
begin
  new.company_domain := normalize_company_domain(new.company_domain);
  return new;
end;
$$;

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table leads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id) on delete cascade,

  company_name text not null,
  company_domain text not null,

  qualification_status text not null check (
    qualification_status in ('qualified', 'not_qualified', 'needs_review')
  ),
  confidence numeric(3, 2) not null,

  fit_reasons text[] not null default '{}',
  concerns text[] not null default '{}',
  source_urls text[] not null default '{}',
  source_summary text,

  discovery_payload jsonb,
  scraper_used text check (scraper_used in ('crawl4ai', 'firecrawl')),
  injection_flagged boolean not null default false,
  evidence_gap_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint confidence_range check (confidence >= 0 and confidence <= 1),
  -- coalesce(...,0) matters: array_length() on a genuinely empty array
  -- ('{}') returns NULL, not 0, and a CHECK expression that evaluates to
  -- NULL is treated by Postgres as *passing*, not failing - a plain
  -- `array_length(source_urls, 1) >= 1` would silently let a `qualified`
  -- lead through with zero evidence, which is exactly the case this
  -- constraint exists to block. Caught by
  -- tests/integration/schema/constraints.test.ts, logged in
  -- BUILD-NOTES-NEXTJS.md.
  constraint qualified_requires_evidence check (
    qualification_status <> 'qualified'
    or (coalesce(array_length(source_urls, 1), 0) >= 1 and coalesce(array_length(fit_reasons, 1), 0) >= 1)
  )
);

create trigger leads_normalize_domain
  before insert or update on leads
  for each row execute function set_leads_company_domain_normalized();

create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

-- Literal name matters: tests assert on the constraint-violation message,
-- which Postgres reports using this index's name.
create unique index leads_run_domain_key on leads (run_id, company_domain);

create index leads_run_id_idx on leads (run_id);
create index leads_qualification_status_idx on leads (qualification_status);

comment on table leads is 'One row per company evaluated in a run. Deduplicated per run by normalized domain (SYSTEM-DESIGN-NEXTJS.md §14).';
