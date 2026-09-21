import { createHash } from "node:crypto";

/**
 * Normalizes a company domain or URL to the canonical form stored in
 * `leads.company_domain` (SYSTEM-DESIGN-NEXTJS.md §14 / §16: "normalized
 * domains (lowercase, strip `www.`, strip protocol and path)"). This is
 * also applied by a database trigger on write, so duplicate detection
 * cannot be bypassed by formatting even if a caller skips this function -
 * this copy exists so the UI and the tool layer can compute the same key
 * before ever reaching the database (e.g. to check a candidate against
 * leads already saved this run, without a round trip).
 */
export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase();

  // Strip a protocol if present; otherwise treat the whole string as a
  // bare host so "foo.com" and "https://foo.com" both parse the same way.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");

  // Strip path, query, and fragment - everything after the first slash,
  // question mark, or hash.
  value = value.split(/[/?#]/, 1)[0] ?? value;

  // Strip a port.
  value = value.replace(/:\d+$/, "");

  // Strip a leading "www." label only - other subdomains are preserved,
  // since "app.example.com" is a materially different site than
  // "example.com" for our purposes.
  value = value.replace(/^www\./, "");

  return value;
}

/**
 * A stable hash of a qualification objective, used to cache the intake
 * classifier's result (SYSTEM-DESIGN-NEXTJS.md §7.1: "Classifier results
 * are cached by a hash of the normalized objective, so editing unrelated
 * form fields, retyping, or a failed submit does not re-spend the call.")
 *
 * Normalization (trim, lowercase, collapse internal whitespace) happens
 * before hashing so cosmetic differences share a cache entry, matching the
 * intent of that section: don't re-spend a classifier call over
 * whitespace or case.
 */
export function hashObjective(objective: string): string {
  const normalized = objective.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}
