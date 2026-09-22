"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/primitives/action-button";
import { ObjectiveField } from "@/components/intake/objective-field";
import { TargetQualifiedField } from "@/components/intake/target-qualified-field";
import { createRun } from "@/actions/runs";
import type { Runner, Scraper } from "@core/domain/types";
import type { ValidationResult } from "@core/validation/objective";

const RUNNER_DEFAULT = (process.env.NEXT_PUBLIC_RUNNER_DEFAULT as Runner | undefined) ?? "gemini";
const SCRAPER_DEFAULT = (process.env.NEXT_PUBLIC_SCRAPER_DEFAULT as Scraper | undefined) ?? "crawl4ai";
const TARGET_QUALIFIED_DEFAULT = 10;
const MIN_OBJECTIVE_LENGTH = 20;

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
  const [targetQualified, setTargetQualified] = useState(TARGET_QUALIFIED_DEFAULT);
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

  // `validation` is reset to null on every edit to the objective text
  // (ObjectiveField's own onChange), so "has been checked" and "checked
  // for the text currently in the field" are the same condition here -
  // Start run stays disabled until an explicit check has run for
  // whatever is currently typed, and re-locks the moment that text
  // changes again.
  //
  // Only a real "flag" verdict (vague/incoherent/not_a_request/
  // out_of_scope/out_of_scope_unsafe) needs dismissal - "advisory"
  // severity (a low-confidence verdict, or the classifier being
  // unavailable) must never block, per this project's own explicit rule
  // (SYSTEM-DESIGN-NEXTJS.md §13: "validation degrades permissive - it
  // must never be the reason a user cannot start a run"). Gating on
  // "checked" is new; gating on the flag itself still has to respect
  // that rule exactly as it did before.
  const objectiveChecked = validation !== null;
  const hasUnresolvedFlag = objectiveChecked && validation!.severity === "flag" && !dismissed;
  const tooShort = objectiveText.trim().length < MIN_OBJECTIVE_LENGTH;
  const submitDisabled = tooShort || !objectiveChecked || hasUnresolvedFlag;

  function submitDisabledReason(): string | undefined {
    if (!tooShort && objectiveChecked && !hasUnresolvedFlag) return undefined;
    if (tooShort) return "Write a fuller objective before starting.";
    if (!objectiveChecked) return "Check the objective before starting.";
    return "Resolve the flag above before starting.";
  }

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

        <TargetQualifiedField value={targetQualified} onChange={setTargetQualified} />

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
          state={submitDisabled ? { kind: "disabled", reason: submitDisabledReason()! } : undefined}
          action={async (idempotencyKey) => {
            setError(null);
            const result = await createRun({
              objectiveText: objectiveText.trim(),
              targetQualified,
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
