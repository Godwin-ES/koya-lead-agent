import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadRow } from "../db/row-types";
import { listScrapeCacheForUrls } from "../db/cache";
import { checkGrounding, type GroundingCheckResult } from "../safety/grounding";
import { SENDER_COMPANY, SENDER_OFFER, shortCompanyName } from "../domain/outreach";
import { loadScrapedPages } from "./discovered";

/**
 * Checks a draft's sentences against everything its claims could come
 * from: the company's scraped pages, the lead's summary and fit reasons,
 * and the offer itself. Shared by the agent's save_outreach and a
 * reviewer's edits, so both are held to the same sources.
 *
 * `ignoreNames` are names that aren't claims about the company - the
 * sender's company and, for a full edited message, the sender's own name
 * in the signature.
 */
export async function groundDraft(supabase: SupabaseClient, lead: LeadRow, text: string, ignoreNames: string[] = []): Promise<GroundingCheckResult> {
  const pages = (await loadScrapedPages(supabase, lead.run_id)).get(lead.company_domain) ?? new Set<string>();
  const scraped = await listScrapeCacheForUrls(supabase, [...new Set([...lead.source_urls, ...pages])]);
  return checkGrounding({
    draftText: text,
    sourceSummary: [lead.source_summary ?? "", ...lead.fit_reasons, ...scraped.map((p) => p.content_md ?? ""), SENDER_OFFER].join("\n"),
    sourceUrls: lead.source_urls,
    ignoreNames: [SENDER_COMPANY, ...ignoreNames],
    companyNames: [...new Set([lead.company_name, shortCompanyName(lead.company_name)])],
  });
}
