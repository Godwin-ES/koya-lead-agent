"use client";

/**
 * The only run limit a user sets directly - everything else
 * (candidate_limit, scrape_limit, max_turns, max_tool_calls,
 * max_spend_usd) is derived server-side from this one number
 * (packages/core/src/domain/limits.ts's deriveLimitsFromTarget), never
 * trusted from the client. The other five fields, and the "estimated
 * maximum spend" text, used to be editable here - removed deliberately:
 * an average user has no real intuition for "max tool calls" or "scrape
 * budget", and exposing them was noise standing between the user and
 * the one number they actually care about.
 */
export function TargetQualifiedField({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label htmlFor="target_qualified" className="block text-sm font-medium text-[var(--color-text)]">
        Number of qualified companies to find
      </label>
      <input
        id="target_qualified"
        type="number"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(event) => {
          const raw = Number(event.target.value);
          if (Number.isNaN(raw)) return;
          onChange(raw);
        }}
        className="mt-1 w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
      />
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Between 1 and 10.</p>
    </div>
  );
}
