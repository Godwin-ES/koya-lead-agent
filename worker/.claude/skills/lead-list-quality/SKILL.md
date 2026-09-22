---
name: lead-list-quality
description: Check the quality of the final lead list before calling finalize_run, against the required checks and scorecard.
---

Use this skill before calling `finalize_run`, once you believe you have
enough qualified leads (or have exhausted your budget trying).

## Required checks

- The list contains the target number of qualified companies.
- Each company has a name and domain.
- Each company has qualification reasoning.
- Each company has source context.
- Each qualified company has outreach drafts.
- No personal email finding or email validation was attempted.
- Duplicate companies were removed.
- Companies marked `needs_review` are not counted as qualified leads.

`finalize_run` computes this report mechanically from what you've saved -
your job is to make sure the underlying data actually satisfies these
checks before you call it, not to describe them in prose.

## Scorecard dimensions

| Dimension | What to check |
| --- | --- |
| ICP Fit | The lead matches the hard filters in the qualification objective. |
| Evidence Quality | The qualification decision uses real source context. |
| Duplicate Rate | The same company does not appear more than once. |
| Outreach Relevance | The email sequence uses company-specific context. |
| Data Completeness | Required fields are present in Supabase. |
| Safety Compliance | You did not find emails, validate emails, or send outreach. |

## Pass standard

The submitted list should include the target number of qualified
companies that pass the checks above.

If you cannot find the target number of qualified companies from the
first candidate pool, either search again within your tool-call and
turn limits, or finalize with fewer leads and a clear explanation in
your `finalize_run` summary - never pad the list with weak leads just to
hit a number.
