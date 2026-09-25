/**
 * Outreach drafts: the fixed parts the app adds, and the checks the
 * model's own writing must pass before a draft is saved. Pure and
 * dependency-free.
 *
 * The model writes only the content paragraphs. The greeting and sign-off
 * are added here, so a placeholder like "[Name]" or "[Your Name]" can't
 * reach a draft - live, every draft had both, because the model had no
 * sender name and no recipient name to use.
 */

/** Who is writing, and what they offer - the PRD's business context. Also a grounding source: claims about Koya Talent are checked against this. */
export const SENDER_COMPANY = "Koya Talent";
export const SENDER_OFFER =
  "Koya Talent connects early-stage founders and operators with trained AI automation assistants who join their team to automate repetitive workflows, improve operational throughput, and build AI-enabled internal systems.";

/** No contact names are ever looked up (outreach-safety guide), so every draft opens the same way. */
export const GREETING = "Good day,";

export function composeEmailBody(content: string, senderName: string | null): string {
  const signature = senderName ? `${senderName}\n${SENDER_COMPANY}` : `The ${SENDER_COMPANY} team`;
  return `${GREETING}\n\n${content.trim()}\n\nBest,\n${signature}`;
}

/** LinkedIn shows the sender's profile, so the message carries no sign-off. */
export function composeLinkedInBody(content: string): string {
  return `${GREETING} ${content.trim()}`;
}

/** LinkedIn's connection-note limit, greeting included. */
export const LINKEDIN_MAX_CHARS = 300;

const EMAIL_WORD_LIMITS: Record<1 | 2 | 3, { min: number; max: number }> = {
  1: { min: 40, max: 130 },
  2: { min: 35, max: 120 },
  3: { min: 15, max: 70 },
};

/**
 * Phrases that mark copy as templated or salesy - the copywriting guide's
 * "write like a person, not a promotion", "avoid fake urgency, exaggerated
 * claims, and generic praise", and its weak-personalization examples.
 */
export const BANNED_PHRASES: readonly string[] = [
  "hope this email finds you well",
  "hope this finds you well",
  "hope you're doing well",
  "hope you are doing well",
  "i hope you are well",
  "just checking in",
  "just following up",
  "circle back",
  "touch base",
  "quick question",
  "game-changer",
  "game changer",
  "revolutionize",
  "revolutionise",
  "unlock",
  "supercharge",
  "leverage",
  "synergy",
  "cutting-edge",
  "cutting edge",
  "seamless",
  "in today's fast-paced",
  "fast-paced world",
  "next level",
  "i came across",
  "came across your",
  "loved what you",
  "love what you",
  "looks impressive",
  "i saw your website",
  "we talk to",
  "companies like yours",
  "act now",
  "limited time",
  "don't miss",
  "delve",
  "elevate",
  "empower",
];

const PLACEHOLDER = /\[[^\]\n]{1,60}\]|\{\{[^}]*\}\}|<[A-Za-z][^>\n]{0,40}>/;
const OPENS_WITH_GREETING = /^\s*(hi|hello|hey|dear|good (day|morning|afternoon|evening)|greetings)\b/i;
const SIGN_OFF_LINE = /^\s*(best|best regards|regards|kind regards|warm regards|cheers|thanks|thank you|many thanks|sincerely|all the best|talk soon)\s*[,.!]?\s*$/im;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** "mindzie, inc." -> "mindzie"; "Platform Engineering Labs Inc." -> "Platform Engineering Labs". */
/**
 * The company's own name, from a LinkedIn display name: "mindzie, inc." ->
 * "mindzie"; "Everflow - Partner Marketing Platform" -> "Everflow";
 * "G2X | GovCon GTM Platform" -> "G2X". Live, the company-mention check
 * demanded the whole display name, tagline and all, so a sensible email
 * about Everflow could never pass it.
 */
export function shortCompanyName(name: string): string {
  const beforeTagline = name.split(/\s+[-–—|:]\s+|\s*\|\s*/)[0] ?? name;
  return beforeTagline.replace(/,?\s+(inc\.?|llc|ltd\.?|corp\.?|co\.?|gmbh|plc)$/i, "").trim() || name.trim();
}

/** Short words kept lowercase in a title, unless first or last. */
const TITLE_SMALL_WORDS = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "at", "by", "in", "of", "on", "to", "up", "via", "with", "from", "as", "per", "vs"]);

/**
 * Title Case for subject lines: "financial intelligence workflows at
 * Financiario" -> "Financial Intelligence Workflows at Financiario". Words
 * that already carry their own capitals or aren't plain words - "SaaS",
 * "AI", "G2X", "nextstage.ai" - are left exactly as written.
 */
export function toTitleCase(subject: string): string {
  const words = subject.trim().split(/\s+/);
  return words
    .map((word, i) => {
      const plain = word.replace(/[^A-Za-z]/g, "");
      if (!plain || /[A-Z]/.test(word.slice(1)) || /[\d.@/]/.test(word)) return word;
      const isEdge = i === 0 || i === words.length - 1;
      if (!isEdge && TITLE_SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word
        .split("-")
        .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join("-");
    })
    .join(" ");
}

/**
 * Advisory checks on a reviewer's own edit of a full message (greeting and
 * signature included). A reviewer can save past these - they're reminders,
 * not rules - except a missing email subject, which the database rejects.
 */
export function checkEditedDraft(input: { channel: "email" | "linkedin"; subject: string | null; body: string }): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const body = input.body.trim();
  if (!body) blocking.push("The message can't be empty.");
  if (input.channel === "email" && !input.subject?.trim()) blocking.push("Every email needs a subject line.");

  const placeholder = `${input.subject ?? ""}\n${body}`.match(PLACEHOLDER);
  if (placeholder) warnings.push(`Contains a placeholder: ${placeholder[0]}`);
  const lower = `${input.subject ?? ""} ${body}`.toLowerCase();
  const banned = BANNED_PHRASES.filter((p) => lower.includes(p));
  if (banned.length) warnings.push(`Stock phrases: ${banned.map((p) => `"${p}"`).join(", ")}`);
  if (/[*_#`]{2,}/.test(body)) warnings.push("Contains markdown formatting, which will show as raw characters.");
  if (input.channel === "linkedin" && body.length > LINKEDIN_MAX_CHARS) warnings.push(`${body.length} characters - LinkedIn allows ${LINKEDIN_MAX_CHARS}.`);
  return { blocking, warnings };
}

export interface DraftCheckInput {
  channel: "email" | "linkedin";
  step: number;
  subject: string | null | undefined;
  /** The model's content only - no greeting, no sign-off. */
  content: string;
  evidence: string;
  companyName: string;
  companyDomain: string;
}

/** Every problem with a draft, each written so the model can fix it. Empty means it can be saved. */
export function checkDraft(input: DraftCheckInput): string[] {
  const problems: string[] = [];
  const text = input.content.trim();
  const lower = text.toLowerCase();
  const company = shortCompanyName(input.companyName);

  if (input.channel === "email") {
    const subject = input.subject?.trim() ?? "";
    if (!subject) problems.push(`Email step ${input.step} needs its own subject line - every email in the sequence is a separate email, not a reply.`);
    else {
      if (subject.length > 60 || words(subject) > 8) problems.push(`Subject "${subject}" is too long - keep it under 8 words.`);
      if (/^(re|fwd?)\s*:/i.test(subject)) problems.push(`Subject "${subject}" pretends to be a reply or forward - write a plain subject.`);
      if (/!/.test(subject)) problems.push(`Subject "${subject}" uses an exclamation mark - keep it calm.`);
      if (PLACEHOLDER.test(subject)) problems.push(`Subject "${subject}" contains a placeholder.`);
    }
    const limits = EMAIL_WORD_LIMITS[input.step as 1 | 2 | 3];
    const count = words(text);
    if (limits && count > limits.max) problems.push(`Email step ${input.step} is ${count} words - keep it under ${limits.max}.`);
    if (limits && count < limits.min) problems.push(`Email step ${input.step} is only ${count} words - it needs at least ${limits.min} to say something specific.`);
  } else {
    if (input.subject) problems.push("A LinkedIn message has no subject - leave subject out.");
    const length = `${GREETING} ${text}`.length;
    if (length > LINKEDIN_MAX_CHARS) problems.push(`The LinkedIn message is ${length} characters with the greeting - LinkedIn allows ${LINKEDIN_MAX_CHARS}.`);
  }

  if (OPENS_WITH_GREETING.test(text)) problems.push(`Don't write a greeting - the app adds "${GREETING}" itself. Start with your first sentence.`);
  if (SIGN_OFF_LINE.test(text)) problems.push("Don't write a sign-off or your name - the app adds the sign-off itself. End with your last sentence.");
  if (PLACEHOLDER.test(text)) problems.push(`The body contains a placeholder (${text.match(PLACEHOLDER)![0]}). Write the real words - never a placeholder.`);
  if (/[*_#`]{2,}|^\s*[-*]\s/m.test(text)) problems.push("Write plain text - no markdown, bullets or formatting.");
  if (/!/.test(text)) problems.push("Remove exclamation marks - keep the tone calm and credible.");

  const withSubject = `${input.subject ?? ""} ${lower}`.toLowerCase();
  const banned = BANNED_PHRASES.filter((p) => withSubject.includes(p));
  if (banned.length) problems.push(`Rewrite without these stock phrases: ${banned.map((p) => `"${p}"`).join(", ")}.`);

  const domain = input.companyDomain.toLowerCase();
  const mentionsCompany = lower.includes(company.toLowerCase()) || lower.includes(domain);
  if (!mentionsCompany && !(input.channel === "email" && input.step === 3)) {
    problems.push(`Refer to ${company} by name - the personalization has to be about this company.`);
  }
  if (input.channel === "email" && input.step === 1 && !lower.includes(SENDER_COMPANY.toLowerCase())) {
    problems.push(`Email 1 must say who is writing: introduce ${SENDER_COMPANY} and what it offers.`);
  }

  const evidence = input.evidence.trim();
  if (!evidence) problems.push("personalization_evidence is required: the company fact this draft is built on, and its source URL.");
  else if (!evidence.toLowerCase().includes(domain)) {
    problems.push(`personalization_evidence must name its source - include the URL on ${input.companyDomain} the fact came from.`);
  }

  return problems;
}
