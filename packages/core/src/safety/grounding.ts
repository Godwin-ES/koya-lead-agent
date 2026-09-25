/**
 * Traces each specific-sounding claim in an outreach draft back to the
 * lead's own `source_summary` (assets/outbound-copywriting-guide.md's
 * "Quality Check": "Can each claim be traced to source context?"). Flags,
 * never blocks (Task 12 Step 3) - a human reviews every flagged draft
 * before use, per assets/outreach-safety-guide.md's approval rules.
 *
 * A heuristic, not a model call, so it costs $0 and is deterministic: a
 * sentence carrying a specific detail (a number, or a capitalized
 * multi-word phrase suggesting a proper noun) is flagged unless most of
 * its significant words also appear in the source summary, or it
 * references one of the lead's own source URLs. A generic sentence (a
 * call to action, a question, a pleasantry) is never flagged - this
 * check is about fabrication, not about the copywriting guide's separate
 * "weak personalization" concern ("I saw your website").
 *
 * The overlap check is ratio-based, not "any shared word" - a sentence
 * that merely repeats the company's own name (which trivially appears in
 * both the sentence and the source summary) must not get a free pass for
 * an otherwise-unsupported specific claim sitting right next to it, e.g.
 * "Acme Robotics just raised a $50M Series C led by Sequoia Capital" -
 * "Acme Robotics" overlaps, the funding claim does not, and the ratio
 * across the whole sentence is what catches that.
 */

export interface GroundingCheckInput {
  draftText: string;
  sourceSummary: string;
  sourceUrls: string[];
  /** Names that aren't claims about the company - the sender's own company. Removed before deciding whether a sentence carries a specific detail. */
  ignoreNames?: string[];
  /**
   * The company's own names (full and short). A name alone isn't a detail:
   * a sentence naming the company is checked only when it states something
   * about it, not when it's a conditional, a question, a proposal or a
   * follow-up pleasantry ("If this isn't the right time for Acme...").
   */
  companyNames?: string[];
}

export interface GroundingCheckResult {
  flagged: boolean;
  unsupportedClaims: string[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "this", "that", "we", "you", "your", "our",
  "it", "as", "at", "by", "be", "have", "has", "will", "would", "could",
]);

function significantWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length > 3 && !STOPWORDS.has(w)));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hostOf(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
}

/**
 * Sentence shapes that don't assert a fact: conditionals, questions,
 * proposals (modal verbs) and follow-up or sign-off phrasing. Live, "If this
 * isn't the right time for Health Samurai to look at AI automation support,
 * no problem at all - a short reply either way is appreciated" was flagged
 * only because it named the company.
 */
const CONDITIONAL_START = /^(if|when|whether|unless|should|in case)\b/i;
const NON_CLAIM_PHRASES = /\b(could|would|might|may|no problem|no worries|no pressure|happy to|glad to|feel free|let me know|reach out|reconnect|reply|appreciated|whenever|leave (it|this) (here|there)|open to)\b/i;

function statesSomething(sentence: string): boolean {
  return !CONDITIONAL_START.test(sentence) && !sentence.trim().endsWith("?") && !NON_CLAIM_PHRASES.test(sentence);
}

/** Below this fraction of a sentence's significant words appearing in the source summary, the sentence is treated as unsupported. */
const OVERLAP_RATIO_THRESHOLD = 0.5;

export function checkGrounding(input: GroundingCheckInput): GroundingCheckResult {
  const sourceWords = significantWords(input.sourceSummary);
  const hosts = input.sourceUrls.map(hostOf).filter(Boolean);
  const unsupportedClaims: string[] = [];

  for (const sentence of splitSentences(input.draftText)) {
    const companyNames = (input.companyNames ?? []).filter(Boolean);
    const withoutNames = [...(input.ignoreNames ?? []), ...companyNames].reduce((text, name) => text.split(name).join(""), sentence);
    const hasOtherDetail = /\d/.test(withoutNames) || /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(withoutNames);
    const claimAboutCompany = companyNames.some((name) => sentence.includes(name)) && statesSomething(sentence);
    if (!hasOtherDetail && !claimAboutCompany) continue;

    const sentenceWords = significantWords(sentence);
    const referencesSource = hosts.some((host) => sentence.toLowerCase().includes(host));

    if (referencesSource) continue;

    if (sentenceWords.size === 0) continue; // no significant words to judge overlap against

    const matched = [...sentenceWords].filter((w) => sourceWords.has(w)).length;
    const overlapRatio = matched / sentenceWords.size;

    if (overlapRatio < OVERLAP_RATIO_THRESHOLD) {
      unsupportedClaims.push(sentence);
    }
  }

  return { flagged: unsupportedClaims.length > 0, unsupportedClaims };
}
