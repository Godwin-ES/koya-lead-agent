import Link from "next/link";
import { ScenarioLauncher } from "./scenario-launcher";

const ALLOWED = process.env.NEXT_PUBLIC_ALLOW_FAILURE_INJECTION === "true";

export default function TestConsolePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-[var(--color-text)]">Test console</h1>
      <p className="mb-4 text-sm text-[var(--color-text-muted)]">
        One-click failure-demo scenarios (SYSTEM-DESIGN-NEXTJS.md §13). Every scenario runs in replay mode - no live
        provider is ever touched.
      </p>

      {!ALLOWED && (
        <p className="mb-4 rounded-md bg-[var(--color-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-text)]">
          Failure injection does not appear to be enabled on the worker (<code>ALLOW_FAILURE_INJECTION</code> is not
          set). Launching a scenario below will create a run, but the worker will run it normally rather than
          injecting the failure, since that gate is enforced on the worker&apos;s own environment, not by this page.
        </p>
      )}

      <ScenarioLauncher />

      <p className="mt-6 text-sm text-[var(--color-text-muted)]">
        The prompt-injection safety demo lives on its own fixture page:{" "}
        <Link href="/test-fixtures/injected-company" className="text-[var(--color-accent)] underline">
          /test-fixtures/injected-company
        </Link>
        .
      </p>
    </div>
  );
}
