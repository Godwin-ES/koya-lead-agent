import type { Content } from "@google/genai";
import { normalizeDomain } from "@core/domain/normalize";

/**
 * Keeps the Gemini conversation from growing without bound. The runner
 * re-sends the whole history on every turn, so each scraped page (~3k
 * tokens) and each discovery result (~10k) is paid for again on every
 * later turn - live, input grew from 5.6k to 30.8k tokens in 21 turns and
 * hit the free tier's 250k-tokens-per-minute limit.
 *
 * Only the model's copy in the history is replaced, and only once nothing
 * later needs it:
 * - a scraped page, once its company is saved as not_qualified or
 *   needs_review (no outreach follows), or - for a qualified lead - once
 *   all three email steps and the LinkedIn message are saved;
 * - a discovery result, once every candidate it kept has a saved lead.
 * The full text is untouched in scrape_cache and tool_calls.result_data.
 */

interface Location {
  historyIndex: number;
  partIndex: number;
}

interface ScrapeEntry extends Location {
  domain: string;
  url: string;
  trimmed: boolean;
}

interface DiscoveryEntry extends Location {
  domains: string[];
  trimmed: boolean;
}

const OUTREACH_PARTS_NEEDED = ["email:1", "email:2", "email:3", "linkedin"];

export interface ToolOutcome {
  toolName: string;
  args: Record<string, unknown>;
  data: unknown;
  partIndex: number;
}

export class HistoryTrimmer {
  private scrapes: ScrapeEntry[] = [];
  private discoveries: DiscoveryEntry[] = [];
  /** Saved lead status per domain. */
  private leadStatus = new Map<string, string>();
  private leadDomainById = new Map<string, string>();
  private outreachByLead = new Map<string, Set<string>>();

  constructor(private readonly history: Content[]) {}

  /** Call after a turn's function responses have been pushed to the history, with every successful call from that turn. */
  recordTurn(historyIndex: number, outcomes: ToolOutcome[]): void {
    for (const o of outcomes) this.record(historyIndex, o);
    this.trimWhatIsDone();
  }

  private record(historyIndex: number, o: ToolOutcome): void {
    const data = (o.data ?? {}) as Record<string, unknown>;

    if (o.toolName === "scrape_site" && typeof data.candidateDomain === "string") {
      this.scrapes.push({ historyIndex, partIndex: o.partIndex, domain: data.candidateDomain, url: String(o.args.url ?? data.url ?? ""), trimmed: false });
    }

    if (o.toolName === "discover_companies" && Array.isArray(data.candidates)) {
      const domains = (data.candidates as Array<{ domain?: unknown }>).map((c) => c.domain).filter((d): d is string => typeof d === "string");
      if (domains.length) this.discoveries.push({ historyIndex, partIndex: o.partIndex, domains, trimmed: false });
    }

    if (o.toolName === "save_lead" && typeof data.company_domain === "string") {
      const domain = normalizeDomain(data.company_domain);
      this.leadStatus.set(domain, String(data.qualification_status));
      if (typeof data.id === "string") this.leadDomainById.set(data.id, domain);
    }

    if (o.toolName === "save_outreach" && typeof data.lead_id === "string") {
      const parts = this.outreachByLead.get(data.lead_id) ?? new Set<string>();
      parts.add(data.channel === "linkedin" ? "linkedin" : `email:${String(data.step)}`);
      this.outreachByLead.set(data.lead_id, parts);
    }
  }

  private outreachDone(domain: string): boolean {
    for (const [leadId, leadDomain] of this.leadDomainById) {
      if (leadDomain !== domain) continue;
      const saved = this.outreachByLead.get(leadId);
      return OUTREACH_PARTS_NEEDED.every((p) => saved?.has(p));
    }
    return false;
  }

  private pageNoLongerNeeded(domain: string): boolean {
    const status = this.leadStatus.get(domain);
    if (!status) return false;
    return status !== "qualified" || this.outreachDone(domain);
  }

  private replaceOutput(loc: Location, output: string): void {
    const part = this.history[loc.historyIndex]?.parts?.[loc.partIndex];
    if (part?.functionResponse) part.functionResponse.response = { output };
  }

  private trimWhatIsDone(): void {
    for (const s of this.scrapes) {
      if (s.trimmed || !this.pageNoLongerNeeded(s.domain)) continue;
      const status = this.leadStatus.get(s.domain);
      this.replaceOutput(
        s,
        `[Page text for ${s.url} removed from this conversation: ${s.domain} is saved as ${status}${status === "qualified" ? " and its outreach is drafted" : ""}. The full page is still stored.]`,
      );
      s.trimmed = true;
    }

    for (const d of this.discoveries) {
      if (d.trimmed || !d.domains.every((domain) => this.leadStatus.has(domain))) continue;
      const summary = d.domains.map((domain) => `${domain} (${this.leadStatus.get(domain)})`).join(", ");
      this.replaceOutput(d, `[Discovery result removed from this conversation - every company it kept now has a saved lead: ${summary}.]`);
      d.trimmed = true;
    }
  }
}
