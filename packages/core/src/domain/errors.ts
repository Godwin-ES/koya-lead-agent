/**
 * Readable text for any thrown value. Supabase returns database errors as
 * plain objects ({ message, details, hint, code }), not Error instances,
 * so `String(err)` turned them into "[object Object]" - in the timeline,
 * the logs, and in what the model was told. Live, every rejected email
 * step read "[object Object]" instead of the constraint that rejected it.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    if (typeof e.message === "string" && e.message) {
      const extra = [e.details, e.hint].filter((x): x is string => typeof x === "string" && x.length > 0);
      return [e.message, ...extra].join(" - ") + (typeof e.code === "string" && e.code ? ` (${e.code})` : "");
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
