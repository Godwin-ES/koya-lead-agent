"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/primitives/action-button";
import { ObjectiveField } from "@/components/intake/objective-field";
import { LimitSteppers } from "@/components/intake/limit-steppers";
import { createRun } from "@/actions/runs";
import { LIMIT_DEFAULTS } from "@core/domain/limits";
import type { RunLimits, Runner, Scraper } from "@core/domain/types";
import type { ValidationResult } from "@core/validation/objective";

const RUNNER_DEFAULT = (process.env.NEXT_PUBLIC_RUNNER_DEFAULT as Runner | undefined) ?? "gemini";
const SCRAPER_DEFAULT = (process.env.NEXT_PUBLIC_SCRAPER_DEFAULT as Scraper | undefined) ?? "crawl4ai";

const RUNNER_NOTE: Record<Runner, string> = {
  gemini: "Cheapest for iteration. Not valid evidence for the Agent SDK submission requirement.",
  "agent-sdk": "The Claude Agent SDK - required for the final evidence run.",
};

const MODEL_NOTE: Record<string, string> = {
  "claude-haiku-4-5": "Cheapest and fastest. Good for a quick pass.",
  "claude-sonnet-5": "Balanced cost and quality.",
  "claude-opus-5": "Highest quality, highest cost - the default for judgment-heavy work.",
};

const SCRAPER_NOTE: Record<Scraper, string> = {
  crawl4ai: "Self-hosted, free and unlimited. Local development default.",
  firecrawl: "Hosted API, uses paid credits. The deployed worker's default.",
};

export default function NewRunPage() {
  const router = useRouter();
  const [objectiveText, setObjectiveText] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [limits, setLimits] = useState<RunLimits>(LIMIT_DEFAULTS);
  const [runner, setRunner] = useState<Runner>(RUNNER_DEFAULT);
  const [model, setModel] = useState("claude-opus-5");
  const [scraper, setScraper] = useState<Scraper>(SCRAPER_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const dirty = objectiveText.trim().length > 0;

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const submitDisabled = Boolean(validation && validation.blocking && !dismissed) || objectiveText.trim().length < 20;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">New run</h1>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Describe who you&apos;re looking for. The agent turns this into explicit ICP criteria before it searches.
      </p>

      <form
        className="mt-6 space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          submitRef.current?.click();
        }}
      >
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />

        <ObjectiveField
          value={objectiveText}
          onChange={setObjectiveText}
          validation={validation}
          onValidationChange={setValidation}
          dismissed={dismissed}
          onDismiss={() => setDismissed(true)}
        />

        <LimitSteppers limits={limits} scraper={scraper} onChange={(patch) => setLimits((l) => ({ ...l, ...patch }))} />

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="runner" className="block text-xs font-medium text-[var(--color-text-muted)]">
              Runner
            </label>
            <select
              id="runner"
              value={runner}
              onChange={(event) => setRunner(event.target.value as Runner)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)]"
            >
              <option value="gemini">Gemini</option>
              <option value="agent-sdk">Claude Agent SDK</option>
            </select>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{RUNNER_NOTE[runner]}</p>
          </div>

          {runner === "agent-sdk" && (
            <div>
              <label htmlFor="model" className="block text-xs font-medium text-[var(--color-text-muted)]">
                Model
              </label>
              <select
                id="model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)]"
              >
                <option value="claude-haiku-4-5">Haiku 4.5</option>
                <option value="claude-sonnet-5">Sonnet 5</option>
                <option value="claude-opus-5">Opus 5</option>
              </select>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{MODEL_NOTE[model]}</p>
            </div>
          )}

          <div>
            <label htmlFor="scraper" className="block text-xs font-medium text-[var(--color-text-muted)]">
              Scraper
            </label>
            <select
              id="scraper"
              value={scraper}
              onChange={(event) => setScraper(event.target.value as Scraper)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)]"
            >
              <option value="crawl4ai">Crawl4AI</option>
              <option value="firecrawl">Firecrawl</option>
            </select>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{SCRAPER_NOTE[scraper]}</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger-text)]">
            {error}
          </p>
        )}

        <ActionButton
          ref={submitRef}
          idleLabel="Start run"
          pendingLabel="Starting"
          state={submitDisabled ? { kind: "disabled", reason: "Fix the objective above before starting." } : undefined}
          action={async (idempotencyKey) => {
            setError(null);
            const result = await createRun({
              objectiveText: objectiveText.trim(),
              limits,
              runner,
              model: runner === "agent-sdk" ? model : undefined,
              scraper,
              dismissed,
              idempotencyKey,
            });
            if (result.error) {
              setError(result.error);
              return;
            }
            if (result.runId) {
              router.push(`/runs/${result.runId}`);
            }
          }}
        />
      </form>
    </div>
  );
}
