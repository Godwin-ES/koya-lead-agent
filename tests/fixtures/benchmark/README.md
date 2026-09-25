# Benchmark ground truth

`ground-truth.json` is a hand-labelled map of `company_domain -> "qualified" | "not_qualified"`,
used by `scripts/benchmark.ts` to score each model's qualification precision
(`packages/core/src/benchmark/score.ts`'s `scoreQualification`).

It starts empty (`{}`) because the actual candidate domains aren't known until
`scripts/live/benchmark-record.ts` has run once and printed the real companies
Apify discovered for the fixed benchmark objective. Labelling before that would
mean guessing at company names, not a real ground truth.

## Filling it in

After running `scripts/live/benchmark-record.ts`, it prints every discovered
domain per model. Look up each one and label it `"qualified"` or
`"not_qualified"` against the fixed objective ("Find US-based B2B logistics
software companies with 20-100 employees, selling to warehouse operators"),
independent of what any model decided - this is what the models are being
scored against.

Domains left unlabeled are skipped by `scoreQualification`, not penalized -
labelling every discovered candidate isn't required for a meaningful score,
but more labels make the comparison more meaningful.

# Business-model labels

`business-model-labels.json` labels 18 real companies from the
harvestapi/linkedin-company-search probes on the two criteria the
lead-qualification skill's evidence tests are most likely to get wrong:
**b2b** and **saas**. Most of the `saas: false` ones are the hard cases:
companies whose own text is *about* SaaS (implementation partners,
migration services, review sites, agencies for SaaS companies) but which
sell services, not software.

The labels are still a **draft**: they come from each company's LinkedIn
description only. Check each against the company's website before trusting
a score computed from them.

To use them, a live pass has to run qualification on these domains: scrape
each site, have the agent judge it, and compare its B2B/SaaS verdicts
(the `fit_reasons` / `concerns` lines) with the labels. That spends real
Apify/model budget, so it's run by hand, never by `pnpm test`.
