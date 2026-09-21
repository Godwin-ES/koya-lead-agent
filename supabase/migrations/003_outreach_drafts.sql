-- Task 4, migration 3 of 7: `outreach_drafts` and the trigger that refuses
-- to attach a draft to any lead that isn't `qualified`.
-- SYSTEM-DESIGN-NEXTJS.md §16 (`outreach_drafts`).

create table outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,

  channel text not null check (channel in ('email', 'linkedin')),
  step int not null check (step between 1 and 3),

  -- Required for email (subject line), never set for linkedin - matches
  -- packages/core/src/schemas/outreach.ts's discriminated union, enforced
  -- here too so the rule holds even for a direct write.
  subject text,
  body text not null,
  personalization_note text not null,

  grounding_check jsonb,
  flagged_unsupported boolean not null default false,

  created_at timestamptz not null default now(),

  unique (lead_id, channel, step),
  constraint email_requires_subject check (channel <> 'email' or subject is not null),
  constraint linkedin_has_no_subject check (channel <> 'linkedin' or subject is null),
  constraint linkedin_is_always_step_one check (channel <> 'linkedin' or step = 1)
);

create function check_outreach_requires_qualified() returns trigger
language plpgsql as $$
declare
  lead_status text;
begin
  select qualification_status into lead_status from leads where id = new.lead_id;
  if lead_status is distinct from 'qualified' then
    raise exception 'outreach_requires_qualified: lead % is %, not qualified', new.lead_id, lead_status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger outreach_drafts_requires_qualified
  before insert or update on outreach_drafts
  for each row execute function check_outreach_requires_qualified();

create index outreach_drafts_lead_id_idx on outreach_drafts (lead_id);

comment on table outreach_drafts is 'Review-ready outreach copy. Never sent - drafting only (SYSTEM-DESIGN-NEXTJS.md §4.5).';
