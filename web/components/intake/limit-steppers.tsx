"use client";

import { estimateMaxSpendUsd } from "@core/domain/limits";
import type { RunLimits, Scraper } from "@core/domain/types";

/**
 * Placeholder per-unit costs for the *estimate only* - real Apify
 * per-result pricing is still pending confirmation in the console
 * (app/docs/provider-findings.md, Task 1 Step 3). estimateMaxSpendUsd
 * itself never embeds a guessed number (packages/core/src/domain/limits.ts);
 * only this UI-level caller does, and only as a clearly-labelled estimate.
 * Overridable via env once real pricing lands.
 */
const PER_CANDIDATE_USD = Number(process.env.NEXT_PUBLIC_APIFY_EST_PER_CANDIDATE_USD ?? "0.01");
const PER_SCRAPE_USD = Number(process.env.NEXT_PUBLIC_FIRECRAWL_EST_PER_PAGE_USD ?? "0.002");

interface StepperField {
  key: keyof RunLimits;
  label: string;
  min: number;
  max: number;
  step: number;
}

const FIELDS: StepperField[] = [
  { key: "target_qualified", label: "Target qualified leads", min: 1, max: 10, step: 1 },
  { key: "candidate_limit", label: "Candidate companies to discover", min: 1, max: 40, step: 1 },
  { key: "scrape_limit", label: "Websites to scrape", min: 1, max: 40, step: 1 },
  { key: "max_turns", label: "Max agent turns", min: 1, max: 200, step: 5 },
  { key: "max_tool_calls", label: "Max tool calls", min: 1, max: 400, step: 10 },
  { key: "max_spend_usd", label: "Max external spend (USD)", min: 0, max: 5, step: 0.1 },
];

export function LimitSteppers({
  limits,
  scraper,
  onChange,
}: {
  limits: RunLimits;
  scraper: Scraper;
  onChange: (patch: Partial<RunLimits>) => void;
}) {
  const estimate = estimateMaxSpendUsd(
    { candidate_limit: limits.candidate_limit, scrape_limit: limits.scrape_limit, scraper },
    { perCandidateUsd: PER_CANDIDATE_USD, perScrapeUsd: PER_SCRAPE_USD },
  );

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-[var(--color-text)]">Limits</legend>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={field.key} className="block text-xs font-medium text-[var(--color-text-muted)]">
              {field.label}
            </label>
            <input
              id={field.key}
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={limits[field.key]}
              onChange={(event) => {
                const raw = Number(event.target.value);
                if (Number.isNaN(raw)) return;
                onChange({ [field.key]: raw } as Partial<RunLimits>);
              }}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)]"
            />
          </div>
        ))}
      </div>
      <p data-testid="estimated-max-spend" className="text-sm text-[var(--color-text-muted)]">
        Estimated maximum spend:{" "}
        <span className="font-medium text-[var(--color-text)]">${estimate.toFixed(2)}</span>
        {scraper === "crawl4ai" && " (scraping is self-hosted and free)"}
      </p>
    </fieldset>
  );
}
