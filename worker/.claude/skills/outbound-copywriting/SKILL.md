---
name: outbound-copywriting
description: Draft a review-ready 3-step cold email sequence plus an optional LinkedIn message for each qualified lead.
---

Use this skill for every lead you save as `qualified`, after calling
`save_lead` and before calling `finalize_run`.

## Required output

For each qualified lead, generate a 3-step cold email sequence via
`save_outreach` (channel `email`, steps 1, 2, 3), plus one `linkedin`
message (step 1) if you have enough material for it.

Each email step needs: subject line, email body, personalization note.

## Copy rules

- Use the company context you actually gathered during discovery and scraping.
- Keep each email short and direct.
- Write like a person, not a promotion.
- Do not invent details about the company - every specific claim must trace back to what you scraped or discovered.
- Avoid fake urgency, exaggerated claims, and generic praise.
- Do not include personal email addresses unless the user explicitly provided them.
- Do not send outreach. `save_outreach` only stores a draft for human review.

## Suggested sequence structure

**Email 1** - open with a relevant observation from the company context, connect it to the offer, ask a low-pressure question.

**Email 2** - add another relevant angle: a workflow bottleneck, scaling challenge, or operational pattern connecting to AI automation support.

**Email 3** - keep the final follow-up brief. Invite a reply if the timing or fit is wrong.

## Personalization

Good personalization references evidence: website positioning, product or
service category, audience served, hiring or scaling signal, a public
workflow or operational clue.

Weak personalization is vague: "Loved what you are building," "Your
company looks impressive," "I saw your website." Avoid this even though
it isn't unsafe - it's just not useful copy.

## Before finalizing each draft, check

- Does the email mention a real company-specific detail?
- Can each claim be traced to the source context you gathered?
- Is the ask clear?
- Is the tone calm and credible?
- Would a human want to review this before sending?
