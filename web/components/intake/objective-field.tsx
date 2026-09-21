"use client";

import { useEffect, useRef, useState } from "react";
import { ValidationFlag } from "./validation-flag";
import { checkObjective } from "@/actions/validation";
import type { ValidationResult } from "@core/validation/objective";

const MIN_LENGTH = 20;
const MAX_LENGTH = 1000;
const DEBOUNCE_MS = 600;

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
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef<string | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < MIN_LENGTH || trimmed === lastCheckedRef.current) {
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setChecking(true);
      try {
        const result = await checkObjective(trimmed);
        lastCheckedRef.current = trimmed;
        onValidationChange(result);
      } catch {
        // A validation-check failure must never block typing or
        // submission (SYSTEM-DESIGN-NEXTJS.md §13: validation degrades
        // permissive) - just leave the field unflagged for now.
        onValidationChange(null);
      } finally {
        setChecking(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, onValidationChange]);

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
        placeholder="Find 10 US B2B SaaS companies with 10 to 100 employees that may need AI automation support"
        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
      />
      <div className="mt-1 flex justify-between text-xs text-[var(--color-text-muted)]">
        <span>{checking ? "Checking..." : " "}</span>
        <span>
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
