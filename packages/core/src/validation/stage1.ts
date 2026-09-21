/**
 * SYSTEM-DESIGN-NEXTJS.md §7.1's Stage 1: deterministic, free, no model
 * call. Rejects what does not need judgment; stage 1 failures never
 * reach the classifier. Every rejection here maps onto a dismissible
 * verdict at the gate level (objective.ts) - stage 1 is a fast,
 * cost-free pre-filter, not an independent hard block.
 *
 * `MIN_LENGTH` here (8) is deliberately lower than the intake form's own
 * 20-char minimum (§7's table) - this is a "too trivial to mean
 * anything" floor (catches "" and "find"), not the form's stricter
 * UI-level requirement, which Task 9 enforces separately. Set any higher
 * and short-but-specific bad inputs like a bare URL or a run of symbols
 * would be masked by a generic "too short" instead of their real,
 * more useful classification.
 */

const MIN_LENGTH = 8;
const MAX_LENGTH = 1000;
const MIN_LONGEST_WORD = 4;

export type Stage1Code = "too_short" | "too_long" | "no_alpha" | "bare_url" | "gibberish";

export type Stage1Result = { ok: true } | { ok: false; code: Stage1Code };

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Common QWERTY row runs, forward or reversed - a cheap keyboard-mash signal. */
const KEYBOARD_RUNS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "poiuytrewq", "lkjhgfdsa", "mnbvcxz"];

function stripPunctuation(text: string): string {
  return text.replace(/[^a-zA-Z0-9\s]/g, " ");
}

/** Five or more of the exact same character in a row - "aaaaaaaa". */
function hasRepeatedCharacterRun(text: string): boolean {
  return /(.)\1{4,}/.test(text);
}

/** The same block of 2+ characters repeated back to back - "asdkjhasdkjh". */
function hasRepeatedSubstring(lettersOnly: string): boolean {
  return /(.{2,})\1+/.test(lettersOnly);
}

function hasKeyboardRun(lettersOnly: string): boolean {
  return KEYBOARD_RUNS.some((run) => lettersOnly.includes(run.slice(0, 6)));
}

/**
 * Fraction of unique letters, gated to short strings only - past roughly
 * 30 letters, normal English prose naturally reuses common letters often
 * enough that this ratio drops on its own, so applying it to a full
 * sentence produces false positives on perfectly good objectives.
 */
function letterEntropySeemsLow(lettersOnly: string): boolean {
  if (lettersOnly.length < 8 || lettersOnly.length > 30) return false;
  const unique = new Set(lettersOnly).size;
  return unique / lettersOnly.length < 0.35;
}

export function stage1(rawText: string): Stage1Result {
  const text = rawText.trim();

  if (text.length < MIN_LENGTH) {
    return { ok: false, code: "too_short" };
  }
  if (text.length > MAX_LENGTH) {
    return { ok: false, code: "too_long" };
  }

  const alphaOnly = text.replace(/[^a-zA-Z]/g, "");
  if (alphaOnly.length === 0) {
    return { ok: false, code: "no_alpha" };
  }

  if (URL_PATTERN.test(text) || EMAIL_PATTERN.test(text)) {
    return { ok: false, code: "bare_url" };
  }

  const lettersOnly = text.toLowerCase().replace(/[^a-z]/g, "");
  if (
    hasRepeatedCharacterRun(text) ||
    hasRepeatedSubstring(lettersOnly) ||
    hasKeyboardRun(lettersOnly) ||
    letterEntropySeemsLow(lettersOnly)
  ) {
    return { ok: false, code: "gibberish" };
  }

  const words = stripPunctuation(text).split(/\s+/).filter(Boolean);
  const longestWord = words.reduce((max, w) => Math.max(max, w.length), 0);
  if (longestWord < MIN_LONGEST_WORD) {
    // No word long enough to carry real meaning (e.g. all 2-3 letter
    // abbreviations) - not obviously gibberish, but not enough content
    // either. Closer to "too short" in spirit than "gibberish".
    return { ok: false, code: "too_short" };
  }

  return { ok: true };
}
