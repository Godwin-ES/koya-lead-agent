"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ValidationFlag } from "./validation-flag";
import { ActionButton } from "@/components/primitives/action-button";
import { checkObjective } from "@/actions/validation";
import type { ValidationResult } from "@core/validation/objective";

const MIN_LENGTH = 20;
const MAX_LENGTH = 1000;

/**
 * Checking used to fire automatically 600ms after every pause in typing -
 * a real, billable classifier call on every debounced pause while
 * composing or revising a long objective, not just once. Replaced with an
 * explicit "Check objective" button: one deliberate call per check, and
 * `validation` (owned by the parent, reset to null on every edit) doubles
 * as the "has this exact text been checked yet" signal the parent gates
 * Start run on - editing the text after a check invalidates it, requiring
 * a fresh check before submitting again.
 */
export function ObjectiveField({
  value,
  onChange,
  validation,
  onValidationChange,
  dismissed,
  onDismiss,
}: {
  value: string;
  onChange: (text: string) => void;
  validation: ValidationResult | null;
  onValidationChange: (result: ValidationResult | null) => void;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  const [lastCheckedText, setLastCheckedText] = useState<string | null>(null);
  const trimmed = value.trim();
  // An unavailable check can be retried on the same text - there's no result to keep.
  const alreadyCheckedThisText = validation !== null && validation.verdict !== "unavailable" && lastCheckedText === trimmed;

  // Excluding severity "none" here isn't just for the success-message
  // case below: ValidationFlag already renders nothing for that verdict
  // (`if (result.severity === "none") return null`), but this wrapping
  // div rendered anyway - an empty, non-visually-detectable
  // `#objective-flag` that the textarea's `aria-describedby` still
  // pointed screen readers at even though there was nothing to describe.
  const showFlag = validation && validation.severity !== "none" && !dismissed;
  // severity "none" only ever means verdict "valid" (buildResult in
  // packages/core/src/validation/objective.ts) - the one outcome
  // ValidationFlag deliberately renders nothing for, which otherwise left
  // a successful check looking indistinguishable from never having
  // checked at all.
  const showSuccess = validation !== null && validation.severity === "none";

  return (
    <div>
      <label htmlFor="objective" className="block text-sm font-medium text-[var(--color-text)]">
        Qualification objective
      </label>
      <textarea
        id="objective"
        rows={3}
        required
        minLength={MIN_LENGTH}
        maxLength={MAX_LENGTH}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onValidationChange(null);
        }}
        aria-invalid={showFlag && validation!.severity === "flag" ? true : undefined}
        aria-describedby={showFlag ? "objective-flag" : undefined}
        placeholder="Find US B2B SaaS companies with 10 to 100 employees that may need AI automation support"
        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
      />
      <div className="mt-2 flex items-center justify-between">
        <ActionButton
          idleLabel="Check objective"
          pendingLabel="Checking"
          variant="secondary"
          state={
            trimmed.length === 0
              ? { kind: "disabled", reason: "Type an objective before checking." }
              : alreadyCheckedThisText
                ? { kind: "disabled", reason: "Already checked - edit the objective to check again." }
                : undefined
          }
          action={async () => {
            try {
              const result = await checkObjective(trimmed);
              setLastCheckedText(trimmed);
              onValidationChange(result);
            } catch {
              // The check couldn't run: the run stays blocked until it can
              // (the same result the server returns for its own outage).
              setLastCheckedText(trimmed);
              onValidationChange({
                verdict: "unavailable",
                confidence: null,
                reason: "The objective check is unavailable right now - try again in a minute. A run can't start until its objective has been checked.",
                missingCriteria: [],
                suggestedRewrite: null,
                dismissible: false,
                blocking: true,
                severity: "flag",
                cached: false,
              });
            }
          }}
        />
        <span className="text-xs text-[var(--color-text-muted)]">
          {value.length}/{MAX_LENGTH}
        </span>
      </div>
      {showSuccess && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-[var(--color-success-bg)] px-3 py-2 text-sm text-[var(--color-success-text)]">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Objective looks good.
        </div>
      )}
      {showFlag && (
        <div id="objective-flag">
          <ValidationFlag
            result={validation!}
            onDismiss={onDismiss}
            onApplyRewrite={(text) => {
              onChange(text);
              onValidationChange(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
