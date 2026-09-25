"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/primitives/action-button";
import { updateDisplayName } from "@/actions/account";

export function DisplayNameForm({ initialName, email }: { initialName: string; email: string }) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const unchanged = name.trim() === initialName.trim();

  return (
    <div className="mt-4 space-y-3">
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium text-[var(--color-text)]">
          Name
        </label>
        <input
          id={inputId}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="e.g. Jordan Reyes"
          maxLength={80}
          autoComplete="name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline focus:outline-2 focus:outline-[var(--color-accent)]"
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-sm text-[var(--color-danger-text)]">
            {error}
          </p>
        )}
      </div>

      <div className="rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
        <div className="text-xs font-medium uppercase tracking-wide">Emails will end with</div>
        <p className="mt-1 whitespace-pre-line text-[var(--color-text)]">{`Best,\n${name.trim() || "The Koya Talent team"}${name.trim() ? "\nKoya Talent" : ""}`}</p>
      </div>

      <div className="flex items-center gap-3">
        <ActionButton
          idleLabel="Save"
          pendingLabel="Saving…"
          state={unchanged ? { kind: "disabled", reason: "No changes to save" } : undefined}
          action={async () => {
            const result = await updateDisplayName(name);
            if (result.error) {
              setError(result.error);
              throw new Error(result.error);
            }
            toast.success("Display name saved");
          }}
          onError={() => undefined}
        />
        <span className="text-xs text-[var(--color-text-muted)]">Signed in as {email}</span>
      </div>
    </div>
  );
}
