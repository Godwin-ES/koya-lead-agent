"use client";

import { useState } from "react";
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
  const alreadyCheckedThisText = validation !== null && lastCheckedText === trimmed;

  const showFlag = validation && !dismissed;

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
            trimmed.length < MIN_LENGTH
              ? { kind: "disabled", reason: `Write at least ${MIN_LENGTH} characters before checking.` }
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
              // A validation-check failure must never block typing or
              // submission (SYSTEM-DESIGN-NEXTJS.md §13: validation
              // degrades permissive) - surface it as the same
              // "unavailable, proceeding without validation" advisory the
              // server side already produces for its own classifier
              // failures, rather than leaving the click looking like it
              // did nothing.
              setLastCheckedText(trimmed);
              onValidationChange({
                verdict: "unavailable",
                confidence: null,
                reason: "Could not check this objective right now - proceeding without validation.",
                missingCriteria: [],
                suggestedRewrite: null,
                dismissible: true,
                blocking: false,
                severity: "advisory",
                cached: false,
              });
            }
          }}
        />
        <span className="text-xs text-[var(--color-text-muted)]">
          {value.length}/{MAX_LENGTH}
        </span>
      </div>
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
