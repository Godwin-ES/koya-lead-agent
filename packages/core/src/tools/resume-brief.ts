import type { SupabaseClient } from "@supabase/supabase-js";
import { getRunById } from "../db/runs";
import { listLeadsForRun } from "../db/leads";
import { listDraftsForLead } from "../db/drafts";
import { listToolCallsForRun } from "../db/tool-calls";
import { loadRunDiscovery, loadScrapedPages } from "./discovered";
import { searchLimit } from "./gate";

/**
 * The handover note a resumed run starts with. A run's work survives a
 * pause, a failure or a worker restart in the database; the model's
 * conversation doesn't. Without this, a resumed run started from nothing:
 * it couldn't find the candidates it had already been shown (de-
 * duplication hides them from new searches), and it didn't know the ids
 * of the leads it had saved, so it could never draft their outreach.
 *
 * Returns null for a run with no earlier work - a fresh start needs no note.
 */
export async function buildResumeBrief(supabase: SupabaseClient, runId: string): Promise<string | null> {
  if ((await listToolCallsForRun(supabase, runId)).length === 0) return null;

  const run = await getRunById(supabase, runId);
  if (!run) return null;

  const leads = await listLeadsForRun(supabase, runId);
  const discovery = await loadRunDiscovery(supabase, runId);
  const scraped = await loadScrapedPages(supabase, runId);
  const counters = run.counters as Record<string, number>;
  const target = run.limits.target_qualified ?? 0;
  const lines = ["RESUMING THIS RUN. It was stopped part-way through; everything below is already saved. Continue from here - don't redo it."];

  if (run.icp && run.discovery_filters) {
    const f = run.discovery_filters;
    lines.push(
      `ICP: already saved (${String((run.icp as Record<string, unknown>).target_company_type ?? "")}). Search filters: industries ${f.industries.map((i) => i.label).join(", ")}; locations ${f.locations.join(", ")}; headcount ${f.headcount_min ?? "any"}-${f.headcount_max ?? "any"}. Don't call save_icp again.`,
    );
  } else {
    lines.push("ICP: not saved yet - start with save_icp.");
  }

  const attemptsUsed = counters.discover_calls_used ?? 0;
  const last = discovery.attempts.at(-1);
  lines.push(
    `Discovery: ${attemptsUsed} of ${searchLimit(run.limits)} attempts used.${last ? ` Last search: keyword ${last.search.keyword ? `"${last.search.keyword}"` : "none"}, page ${last.search.page}, pool ${last.totalResultCount}.` : ""}`,
  );

  const qualified = leads.filter((l) => l.qualification_status === "qualified");
  if (leads.length) {
    lines.push(`Leads saved (${qualified.length} of ${target} qualified):`);
    for (const lead of leads) {
      let outreach = "";
      if (lead.qualification_status === "qualified") {
        const drafts = await listDraftsForLead(supabase, lead.id);
        const have = new Set(drafts.map((d) => (d.channel === "linkedin" ? "LinkedIn" : `email ${d.step}`)));
        const missing = ["email 1", "email 2", "email 3", "LinkedIn"].filter((p) => !have.has(p));
        outreach = missing.length ? ` - outreach still needed: ${missing.join(", ")}` : " - outreach done";
      }
      lines.push(`- ${lead.company_name} (${lead.company_domain}): ${lead.qualification_status}, lead_id ${lead.id}${outreach}`);
    }
  } else {
    lines.push("Leads saved: none yet.");
  }

  const decided = new Set(leads.map((l) => l.company_domain));
  const scrapedUndecided = [...scraped.keys()].filter((d) => !decided.has(d));
  if (scrapedUndecided.length) {
    lines.push(
      `Scraped but not yet saved as a lead (the page text isn't in this conversation - re-scraping the same URL is free and doesn't count against the page limit): ${scrapedUndecided.map((d) => `${d} (${[...scraped.get(d)!].join(", ")})`).join("; ")}.`,
    );
  }

  const waiting = discovery.kept.filter((c) => c.domain && !decided.has(c.domain) && !scraped.has(c.domain));
  if (waiting.length) {
    lines.push(`Kept by discovery but not scraped yet (${waiting.length}) - these won't come back from a new search, so work through them before searching again:`);
    for (const c of waiting) {
      const size = c.employeeCountRange ? `${c.employeeCountRange.start}-${c.employeeCountRange.end ?? "+"}` : "size unknown";
      const flags = [c.prefilter.size, c.prefilter.location].filter((v) => v.status !== "pass").map((v) => v.reason);
      lines.push(`- ${c.name} (${c.domain}): ${c.tagline ?? "no tagline"}; ${size}${flags.length ? `; needs review: ${flags.join(" ")}` : ""}`);
    }
  }

  lines.push(`Scrape pages used so far: ${counters.scrapes_used ?? 0} of ${run.limits.scrape_limit ?? 0}.`);

  return lines.join("\n");
}
