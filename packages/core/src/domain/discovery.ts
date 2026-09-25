import { LINKEDIN_INDUSTRIES } from "../data/linkedin-industries";
import { normalizeDomain } from "./normalize";
import type { DiscoveryFilters } from "../schemas/discovery";

/**
 * Pure, dependency-free discovery logic for harvestapi/linkedin-company-search.
 * Every rule here comes from a live probe (BUILD-NOTES-NEXTJS.md, "[Discovery
 * redesign] Pivot to harvestapi/linkedin-company-search") - not from the
 * actor's docs alone.
 */

// ---------------------------------------------------------------------
// Industry labels -> LinkedIn codes
// ---------------------------------------------------------------------

export interface IndustryResolution {
  resolved: Array<{ id: string; label: string }>;
  unknown: Array<{ input: string; suggestions: string[] }>;
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/** Accepts exact labels (case-insensitive) or numeric codes; anything else comes back with the closest real labels so the agent can correct itself. */
export function resolveIndustries(inputs: string[]): IndustryResolution {
  const resolved: IndustryResolution["resolved"] = [];
  const unknown: IndustryResolution["unknown"] = [];

  for (const raw of inputs) {
    const value = raw.trim();
    const match =
      LINKEDIN_INDUSTRIES.find((i) => i.id === value) ??
      LINKEDIN_INDUSTRIES.find((i) => i.label.toLowerCase() === value.toLowerCase());
    if (match) {
      if (!resolved.some((r) => r.id === match.id)) resolved.push({ id: match.id, label: match.label });
      continue;
    }
    const want = new Set(tokens(value));
    const hits = (text: string) => [...new Set(tokens(text))].filter((t) => want.has(t)).length;
    const suggestions = LINKEDIN_INDUSTRIES.map((i) => ({
      label: i.label,
      // A match in the label itself counts double; ties go to the higher-level (broader) code.
      score: 2 * hits(i.label) + hits(i.hierarchy),
      depth: i.hierarchy.split(">").length,
    }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.depth - b.depth)
      .slice(0, 5)
      .map((s) => s.label);
    unknown.push({ input: value, suggestions });
  }

  return { resolved, unknown };
}

// ---------------------------------------------------------------------
// Headcount -> LinkedIn size buckets
// ---------------------------------------------------------------------

/** The actor's `companySize` enum, with each bucket's numeric bounds. */
const SIZE_BUCKETS: ReadonlyArray<{ value: string; start: number; end: number }> = [
  { value: "1-10", start: 1, end: 10 },
  { value: "11-50", start: 11, end: 50 },
  { value: "51-200", start: 51, end: 200 },
  { value: "201-500", start: 201, end: 500 },
  { value: "501-1000", start: 501, end: 1000 },
  { value: "1001-5000", start: 1001, end: 5000 },
  { value: "5001-10000", start: 5001, end: 10000 },
  { value: "10001+", start: 10001, end: Number.POSITIVE_INFINITY },
];

/** Every bucket overlapping [min, max]. Empty means "no size filter". "10-100 employees" -> ["1-10", "11-50", "51-200"]; the exact bounds are then checked per candidate by prefilterCandidate. */
export function sizeBucketsFor(min: number | null, max: number | null): string[] {
  if (min === null && max === null) return [];
  const lo = min ?? 1;
  const hi = max ?? Number.POSITIVE_INFINITY;
  return SIZE_BUCKETS.filter((b) => b.start <= hi && b.end >= lo).map((b) => b.value);
}

// ---------------------------------------------------------------------
// Raw HarvestAPI item -> normalized candidate
// ---------------------------------------------------------------------

export interface CandidateLocation {
  text: string | null;
  country: string | null;
  countryCode: string | null;
  state: string | null;
  city: string | null;
  headquarter: boolean;
}

export interface NormalizedCandidate {
  linkedinId: string | null;
  universalName: string | null;
  linkedinUrl: string | null;
  name: string;
  website: string | null;
  /** Normalized from `website`; null when LinkedIn has no website for the company. */
  domain: string | null;
  tagline: string | null;
  description: string | null;
  industries: Array<{ id: string; name: string }>;
  specialities: string[];
  /** LinkedIn members linked to the company - not real headcount (see prefilterCandidate). */
  employeeCount: number | null;
  /** Self-reported "About" range; `end: null` means open-ended (10001+). */
  employeeCountRange: { start: number; end: number | null } | null;
  locations: CandidateLocation[];
  companyType: string | null;
  foundedYear: number | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Keeps only what discovery, qualification and the run view use.
 * `similarOrganizations` (LinkedIn's "people also viewed", never a
 * candidate), `peopleStats`, logos and cover images are dropped - together
 * they're most of each raw item's size.
 */
export function normalizeHarvestItem(item: Record<string, unknown>): NormalizedCandidate | null {
  const name = str(item.name);
  if (!name) return null;

  const website = str(item.website);
  const domain = website ? normalizeDomain(website) || null : null;

  const range = item.employeeCountRange as { start?: unknown; end?: unknown } | null | undefined;
  const rangeStart = num(range?.start);

  const rawLocations = Array.isArray(item.locations) ? (item.locations as Array<Record<string, unknown>>) : [];
  const locations: CandidateLocation[] = rawLocations.map((l) => {
    const parsed = (l.parsed ?? {}) as Record<string, unknown>;
    return {
      text: str(parsed.text),
      country: str(parsed.country),
      countryCode: str(parsed.countryCode) ?? str(l.country),
      state: str(parsed.state) ?? str(l.geographicArea),
      city: str(parsed.city) ?? str(l.city),
      headquarter: l.headquarter === true,
    };
  });

  const founded = item.foundedOn as { year?: unknown } | null | undefined;

  return {
    linkedinId: str(item.id),
    universalName: str(item.universalName),
    linkedinUrl: str(item.linkedinUrl),
    name,
    website,
    domain,
    tagline: str(item.tagline),
    description: str(item.description),
    industries: Array.isArray(item.industries)
      ? (item.industries as Array<Record<string, unknown>>).map((i) => ({ id: String(i.id ?? ""), name: String(i.name ?? "") }))
      : [],
    specialities: Array.isArray(item.specialities) ? (item.specialities as unknown[]).filter((s): s is string => typeof s === "string") : [],
    employeeCount: num(item.employeeCount),
    employeeCountRange: rangeStart === null ? null : { start: rangeStart, end: num(range?.end) },
    locations,
    companyType: str(item.companyType),
    foundedYear: num(founded?.year),
  };
}

/** The identities two occurrences of the same company can share across discovery attempts. */
export function candidateKeys(c: Pick<NormalizedCandidate, "linkedinId" | "domain">): string[] {
  const keys: string[] = [];
  if (c.linkedinId) keys.push(`li:${c.linkedinId}`);
  if (c.domain) keys.push(`d:${c.domain}`);
  return keys;
}

// ---------------------------------------------------------------------
// Deterministic prefilter (size + location + verifiability)
// ---------------------------------------------------------------------

export type CriterionStatus = "pass" | "fail" | "needs_review";

export interface PrefilterResult {
  status: CriterionStatus;
  size: { status: CriterionStatus; reason: string };
  location: { status: CriterionStatus; reason: string };
  /** Recorded as lead concerns later; never changes the verdict on its own. */
  concerns: string[];
  /** Set when the candidate is dropped before qualification for a reason that isn't a size/location fail. */
  dropReason: string | null;
}

function checkSize(c: NormalizedCandidate, min: number | null, max: number | null): { result: PrefilterResult["size"]; concerns: string[] } {
  if (min === null && max === null) return { result: { status: "pass", reason: "No headcount criterion." }, concerns: [] };

  const range = c.employeeCountRange;
  if (!range) return { result: { status: "needs_review", reason: "LinkedIn has no company-size range for this company." }, concerns: [] };

  const lo = min ?? 1;
  const hi = max ?? Number.POSITIVE_INFINITY;
  const rangeEnd = range.end ?? Number.POSITIVE_INFINITY;
  const label = `${range.start}-${range.end ?? "+"}`;
  const wanted = `${min ?? 1}-${max ?? "+"}`;

  const concerns: string[] = [];
  // The self-reported range decides (agreed with the user). employeeCount
  // is LinkedIn-member count, which routinely undercounts - only a large
  // mismatch is worth a reviewer's attention, and it never flips the verdict.
  if (c.employeeCount !== null && (c.employeeCount < range.start / 2 || c.employeeCount > rangeEnd * 2)) {
    concerns.push(`LinkedIn shows ${c.employeeCount} linked members against a self-reported ${label} employee range.`);
  }

  const overlapLo = Math.max(range.start, lo);
  const overlapHi = Math.min(rangeEnd, hi);
  if (overlapHi < overlapLo) {
    return { result: { status: "fail", reason: `LinkedIn size range ${label} is outside the required ${wanted}.` }, concerns };
  }
  // A range that shares only its edge with the target (2-10 against
  // 10-100: only a company of exactly 10 would fit) is almost certainly
  // outside it - live, a 2-10 company was qualified on this overlap.
  if (overlapHi === overlapLo && range.start !== rangeEnd) {
    return { result: { status: "needs_review", reason: `LinkedIn size range ${label} only touches the required ${wanted} at ${overlapLo}.` }, concerns };
  }
  return { result: { status: "pass", reason: `LinkedIn size range ${label} overlaps the required ${wanted}.` }, concerns };
}

const LOCATION_ALIASES: Record<string, string[]> = {
  us: ["united states", "us", "usa", "united states of america"],
  gb: ["united kingdom", "uk", "gb", "great britain", "england"],
};

function aliasesFor(target: string): string[] {
  const t = target.trim().toLowerCase();
  for (const group of Object.values(LOCATION_ALIASES)) {
    if (group.includes(t)) return group;
  }
  return [t];
}

export function locationMatches(loc: CandidateLocation, target: string): boolean {
  const wanted = aliasesFor(target);
  const fields = [loc.country, loc.countryCode, loc.state, loc.city].filter((f): f is string => f !== null).map((f) => f.toLowerCase());
  return wanted.some((w) => fields.includes(w) || (loc.text?.toLowerCase().includes(w) ?? false));
}

function checkLocation(c: NormalizedCandidate, targets: string[]): PrefilterResult["location"] {
  if (targets.length === 0) return { status: "pass", reason: "No geography criterion." };
  const matches = (l: CandidateLocation) => targets.some((t) => locationMatches(l, t));
  const hq = c.locations.filter((l) => l.headquarter);
  const describe = (l: CandidateLocation) => l.text ?? [l.city, l.state, l.country].filter(Boolean).join(", ");

  if (c.locations.length === 0) return { status: "needs_review", reason: "LinkedIn lists no location for this company." };
  if (hq.some(matches)) return { status: "pass", reason: `Headquarters: ${describe(hq.find(matches)!)}.` };
  if (hq.length > 0) {
    const other = c.locations.find((l) => !l.headquarter && matches(l));
    return other
      ? { status: "needs_review", reason: `Headquarters is ${describe(hq[0]!)}, with an office in ${describe(other)}.` }
      : { status: "fail", reason: `Headquarters is ${describe(hq[0]!)}, outside ${targets.join(" / ")}.` };
  }
  return c.locations.some(matches)
    ? { status: "needs_review", reason: "Has a location in the required geography, but LinkedIn marks no headquarters." }
    : { status: "fail", reason: `No listed location in ${targets.join(" / ")}.` };
}

/**
 * The only criteria checkable from LinkedIn's structured fields. Everything
 * semantic (B2B, SaaS, funding stage, fit) is judged later from the scraped
 * website, per the lead-qualification skill. A candidate with no website is
 * dropped here: there is nothing for scrape_site to verify against, and a
 * qualified lead needs a real source URL.
 */
export function prefilterCandidate(c: NormalizedCandidate, filters: Pick<DiscoveryFilters, "headcount_min" | "headcount_max" | "locations">): PrefilterResult {
  const size = checkSize(c, filters.headcount_min, filters.headcount_max);
  const location = checkLocation(c, filters.locations);
  const dropReason = c.domain ? null : "No website on the LinkedIn profile to verify against.";

  const verdicts = [size.result.status, location.status];
  const status: CriterionStatus = dropReason || verdicts.includes("fail") ? "fail" : verdicts.includes("needs_review") ? "needs_review" : "pass";

  return { status, size: size.result, location, concerns: size.concerns, dropReason };
}

// ---------------------------------------------------------------------
// searchQuery validation
// ---------------------------------------------------------------------

/** Words describing *criteria* rather than a product - they match vendors and investors that talk about their clients, not the clients themselves (A/B probe: 0 results / service firms). */
const CRITERIA_WORDS = new Set([
  "series", "seed", "preseed", "funded", "funding", "raised", "venture", "vc", "backed",
  "b2b", "b2c", "d2c", "companies", "company", "startup", "startups",
  "employee", "employees", "headcount", "small", "medium", "mid", "midsize", "sized", "smb", "sme",
]);

/**
 * Koya Talent's own offer. Live, Claude searched "workflow automation" for
 * companies that "may need AI automation support": a pool of 4, mostly
 * automation vendors and consultancies. A soft need is judged from the
 * evidence during qualification; searching for it finds the companies
 * selling it.
 */
const OFFER_WORDS = new Set([
  "ai", "artificial", "intelligence", "automation", "automations", "automate", "automated", "automating",
  "workflow", "workflows", "rpa", "agentic", "chatbot", "chatbots", "llm", "genai",
]);

/** Category words that, alone, match company *names* ("SaaS Solutions", "SaaS Direct" - service firms). Allowed alongside a real product/domain noun. */
const BARE_CATEGORY_WORDS = new Set(["saas", "software", "tech", "technology", "it", "digital"]);

export const MAX_KEYWORD_WORDS = 3;

/** Returns null when the keyword is usable, otherwise a reason the agent can act on. */
export function validateSearchKeyword(keyword: string, locations: string[]): string | null {
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Keyword is empty - omit it instead to search on the structured filters alone.";
  if (words.length > MAX_KEYWORD_WORDS) {
    return `Keyword "${keyword}" has ${words.length} words; use at most ${MAX_KEYWORD_WORDS}. LinkedIn matches every word against the company's own profile text, so long phrases return nothing.`;
  }

  const bare = words.map((w) => w.replace(/[^a-z0-9]/g, ""));
  const criteria = bare.filter((w) => CRITERIA_WORDS.has(w));
  if (criteria.length) {
    return `Keyword contains criteria words (${criteria.join(", ")}). Funding stage, business model and size are checked during qualification, not searched for - companies that use those words in their profiles are mostly agencies, VCs and recruiters serving such companies. Use a word the target company would use for its own product or field (e.g. "payments", "scheduling", "compliance").`;
  }

  // Split on hyphens too, so "AI-powered" is caught.
  const offer = keyword.toLowerCase().split(/[^a-z0-9]+/).filter((w) => OFFER_WORDS.has(w));
  if (offer.length) {
    return `Keyword contains words for what Koya Talent sells (${offer.join(", ")}). A need like "may need AI automation support" is judged from each company's evidence during qualification - searching for it returns the companies selling automation, not the ones that could use it. Use a word the target company would use for its own product or field (e.g. "platform", "payments", "scheduling").`;
  }

  const locationWords = new Set(locations.flatMap((l) => aliasesFor(l)).flatMap((l) => l.split(/\s+/)));
  const geo = bare.filter((w) => locationWords.has(w));
  if (geo.length) return `Keyword contains location words (${geo.join(", ")}). Geography is already applied as a filter from the saved ICP.`;

  if (bare.every((w) => BARE_CATEGORY_WORDS.has(w))) {
    return `"${keyword}" on its own matches companies *named* after the category (mostly service firms). The industry filter already selects software companies - use a product or domain noun instead, or omit the keyword.`;
  }

  return null;
}

// ---------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------

/** Candidates requested per discover_companies call: 2x the target, within [10, 25]. The A/B probe's industry-filtered query was 5/5 on-target, so 2x leaves room for scrape-time rejections without paying for a much larger pool. */
export function candidatesPerDiscoverCall(targetQualified: number): number {
  return Math.min(25, Math.max(10, Math.round(targetQualified * 2)));
}
