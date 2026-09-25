---
name: icp-refinement
description: Turn a vague qualification objective into concrete Ideal Customer Profile (ICP) criteria before searching for companies.
---

Use this skill before calling `discover_companies`. Companies cannot be
qualified against criteria that don't exist yet, and search terms drawn
from a vague objective waste discovery budget on the wrong candidates.

## Goal

Understand who counts as a good-fit company before spending tool calls on
discovery and scraping.

## Minimum criteria to clarify

- Target company type
- Industry or niche
- Geography
- Company size or headcount range
- Relevant buyer or operator persona
- Business problem the company may have
- Hard disqualifiers
- Soft preferences

If the objective is missing several of these and you cannot make a
reasonable, stated assumption, call `request_clarification` once with a
single, specific question. If the objective already has enough to work
from, fill in gaps with a clearly labeled reasonable assumption instead
of asking - you only get one clarification per run.

## Hard filters vs. soft preferences

Hard filters must be true for a lead to qualify. Examples: country must be
United States; company must be B2B; headcount must be between 10 and 100.

Soft preferences improve fit but must never disqualify a company on their
own. Examples: recently hiring operations roles; uses tools that may
connect to automation workflows; publishes content about scaling
operations.

Do not treat every user preference as a hard filter - that narrows the
pool for no reason the user actually asked for.

## Output

Before your first `discover_companies` call, call `save_icp` with exactly
this shape:

```json
{
  "target_company_type": "",
  "industries": [],
  "geography": [],
  "headcount_range": "",
  "buyer_persona": "",
  "business_problem": "",
  "hard_filters": [],
  "soft_preferences": [],
  "disqualifiers": []
}
```

## Discovery filters

`save_icp` also takes `discovery_filters`, next to the ICP fields above:
`linkedin_industries` (exact LinkedIn industry labels), `headcount_min` /
`headcount_max` (numbers, or null when the objective gives no bound) and
`locations` (full names: "United States", "United Kingdom" - LinkedIn
reads "UK" as Ukraine). `discover_companies` applies these on every
search, so get them right here.

- **Industries say what kind of company it is**, not its market. A fintech
  or healthtech SaaS company is usually tagged as software, not "Financial
  Services" or "Hospitals and Health Care" - those return banks and
  hospitals. Put the vertical in the search keyword instead.
- **A parent label includes everything under it.** "Technology,
  Information and Internet" covers "Software Development", "Data
  Infrastructure and Analytics", "Internet Marketplace Platforms" - and
  also blogs and internet news. Start narrow and widen only if the pool
  is too small.
- Useful labels: "Software Development" (software products, including
  SaaS - start here), "Technology, Information and Internet" (wider),
  "Data Infrastructure and Analytics", "Business Intelligence Platforms",
  "Internet Marketplace Platforms". Services labels like "IT Services and
  IT Consulting", "Business Consulting and Services", "Advertising
  Services" and "Staffing and Recruiting" are for when the user wants
  service firms. A wrong label comes back with the closest real ones.
- Headcount: "10 to 100 employees" is `headcount_min: 10`,
  `headcount_max: 100`. "Under 50" is `null` / `50`.

## Rules

- Preserve specific constraints the user gives - do not generalize them away.
- Keep the ICP narrow enough to search, but not so narrow that no real company could match it.
- Ask for clarification only when the objective is genuinely too vague to search from, not to double-check something you could reasonably infer.
