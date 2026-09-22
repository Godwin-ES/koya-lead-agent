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
