"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ActionButton } from "@/components/primitives/action-button";
import { signIn } from "./actions";

/**
 * Split out so `useSearchParams()` sits inside a Suspense boundary -
 * this Next.js version requires that for any page using it, or static
 * prerendering bails out with an error (confirmed by an actual failed
 * `next build`, not assumed).
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/runs";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">Koya Lead Agent</h1>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">Sign in to continue.</p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          // Enter-key submission goes through the same ActionButton click
          // path as a mouse click - a disabled button does not disable
          // the form, so Enter must route through the button's own
          // pending/disabled guard rather than bypass it
          // (SYSTEM-DESIGN-NEXTJS.md §17.4).
          event.preventDefault();
          submitRef.current?.click();
        }}
      >
        {/*
          HTML spec detail, not obvious until tested against a real
          browser: with two or more fields and no type="submit" control
          anywhere in the form, pressing Enter does not fire the submit
          event at all (implicit submission on Enter requires either a
          single field or an actual submit button present) - confirmed by
          an Enter-key e2e test that silently did nothing until this was
          added. ActionButton itself stays type="button" (correct for its
          many non-form uses elsewhere in the app); this hidden control
          exists purely to make the browser treat the form as submittable,
          so onSubmit above actually runs.
        */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-[var(--color-text)]">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-[var(--color-text)]">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger-text)]">
            {error}
          </p>
        )}

        <ActionButton
          ref={submitRef}
          action={async () => {
            setError(null);
            const result = await signIn(email, password, next);
            if (result?.error) {
              setError(result.error);
            }
          }}
          idleLabel="Sign in"
          pendingLabel="Signing in"
          className="w-full"
        />
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <Suspense fallback={<div className="h-64 w-full max-w-sm animate-pulse rounded-lg bg-[var(--color-surface-2)]" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
