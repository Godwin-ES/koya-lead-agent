/**
 * SYSTEM-DESIGN-NEXTJS.md §13 "Failure injection": forces a specific
 * failure mode so the Loom's required failure demo is a button press,
 * not a hope that a real provider misbehaves during a live recording.
 *
 * Two independent gates, both required before anything is ever forced:
 * `ALLOW_FAILURE_INJECTION=true` on the *worker's own* environment
 * (never on in production without an explicit opt-in - a deployment
 * that never sets this cannot be made to inject a failure no matter
 * what any run row says), and the specific run being processed must
 * carry the matching `injected_failure` value on its own row - a toggle
 * set for a demo run never affects any other run or any other user's
 * runs, since it's read from that run's own database row, not from
 * global state.
 *
 * Scoped to six modes that fit this run-scoped, worker-side pattern
 * cleanly. `classifier_outage` (§13's table) is deliberately not one of
 * them: it fires in the *web app's* own process, before a run row even
 * exists, so it can't be gated by a run-scoped column at all - and it
 * already has real, dedicated test coverage
 * (tests/unit/validation/gate.test.ts's "degrades permissive when the
 * classifier is unavailable"), so it needs no separate toggle to prove
 * the behavior works. `apify_empty_result` covers the design table's
 * "Apify returns 0 candidates" / "fewer than target" rows together -
 * the ICP-widening/re-search response to a thin result is the *agent's*
 * own reasoning (driven by its skills), not code this toggle needs to
 * force; what this toggle forces is the zero-result condition itself,
 * which is enough to demonstrate the run still reaching a real
 * `partial` outcome rather than hanging or crashing.
 */
export const FAILURE_MODES = [
  "apify_auth_error",
  "apify_empty_result",
  "sidecar_down",
  "model_429",
  "invalid_tool_input",
  "worker_kill",
] as const;

export type FailureMode = (typeof FAILURE_MODES)[number];

export function isFailureInjectionAllowed(): boolean {
  return process.env.ALLOW_FAILURE_INJECTION === "true";
}

/** True only when injection is allowed on this environment *and* this specific run's own row requests this exact mode. */
export function isInjected(mode: FailureMode, injectedFailure: string | null | undefined): boolean {
  return isFailureInjectionAllowed() && injectedFailure === mode;
}
