import type { SupabaseClient } from "@supabase/supabase-js";
import { getRunById } from "@core/db/runs";
import { getLeadById } from "@core/db/leads";
import { listDraftsForLead } from "@core/db/drafts";
import { listScrapeCacheForUrls } from "@core/db/cache";
import { claimNextDraftRequest, finishDraftRequest } from "@core/db/draft-requests";
import { sumCostForRun } from "@core/db/cost";
import { errorMessage } from "@core/domain/errors";
import { isReplayMode } from "@core/providers/replay/recorder";
import { wrapUntrusted } from "@core/safety/untrusted";
import { loadScrapedPages } from "@core/tools/discovered";
import type { RunLimits } from "@core/domain/types";
import type { ToolRunState } from "@core/tools/log";
import { buildDraftingPrompt, type AgentSession } from "./orchestrator";
import { runGeminiAgent } from "./runners/gemini";
import { runAgentSdk } from "./runners/agent-sdk";
import { resolveModel, resolveRunner, resolveScraper } from "./service";
import { draftingFailedMessage, sendDiscord } from "@core/notify/discord";

const OUTREACH_PARTS = ["email 1", "email 2", "email 3", "LinkedIn"] as const;
/** Four drafts, plus room to fix ones the save checks reject. */
const DRAFTING_MAX_TURNS = 12;
const PAGE_CHARS = 8_000;

async function missingParts(supabase: SupabaseClient, leadId: string): Promise<string[]> {
  const drafts = await listDraftsForLead(supabase, leadId);
  const have = new Set(drafts.map((d) => (d.channel === "linkedin" ? "LinkedIn" : `email ${d.step}`)));
  return OUTREACH_PARTS.filter((p) => !have.has(p));
}

export interface DraftRequestResult {
  claimed: boolean;
  requestId?: string;
  status?: "done" | "failed";
}

/**
 * Claims one "draft outreach" request (a reviewer qualified a lead, or
 * asked for its missing drafts) and runs a focused agent session for it:
 * only save_outreach, with the lead's evidence and scraped pages, under
 * the same copywriting skill and save checks as a full run.
 */
export async function claimAndProcessDraftRequest(supabase: SupabaseClient, workerId: string, shouldStop?: () => boolean): Promise<DraftRequestResult> {
  const request = await claimNextDraftRequest(supabase, workerId, isReplayMode());
  if (!request) return { claimed: false };

  try {
    const [run, lead] = await Promise.all([getRunById(supabase, request.run_id), getLeadById(supabase, request.lead_id)]);
    if (!run || !lead) throw new Error("The run or lead no longer exists.");
    if (lead.qualification_status !== "qualified") throw new Error(`${lead.company_name} is ${lead.qualification_status}, not qualified.`);

    const missing = await missingParts(supabase, lead.id);
    if (missing.length === 0) {
      await finishDraftRequest(supabase, request.id, "done", null);
      return { claimed: true, requestId: request.id, status: "done" };
    }

    const scrapedUrls = (await loadScrapedPages(supabase, run.id)).get(lead.company_domain) ?? new Set<string>();
    const pages = (await listScrapeCacheForUrls(supabase, [...new Set([...lead.source_urls, ...scrapedUrls])]))
      .filter((p) => p.content_md)
      .map((p) => wrapUntrusted({ url: p.url, scraper: p.scraper, text: p.content_md!, maxChars: PAGE_CHARS }));

    const session: AgentSession = {
      prompt: buildDraftingPrompt({
        lead: {
          id: lead.id,
          companyName: lead.company_name,
          companyDomain: lead.company_domain,
          fitReasons: lead.fit_reasons,
          concerns: lead.concerns,
          sourceSummary: lead.source_summary ?? "",
          reviewReason: lead.review_reason,
        },
        missingParts: missing,
        pages,
      }),
      tools: ["save_outreach"],
      maxTurns: DRAFTING_MAX_TURNS,
      isDone: async () => (await missingParts(supabase, lead.id)).length === 0,
      fixtureSet: `${run.fixture_set ?? "live"}-drafting`,
    };

    const runState: ToolRunState & { objectiveRaw: string; fixtureSet?: string | null } = {
      id: run.id,
      icp: run.icp,
      limits: run.limits as RunLimits,
      counters: { qualified_count: 0, ...(run.counters as Record<string, number>) },
      clarificationCount: run.clarification_count,
      spentUsd: await sumCostForRun(supabase, run.id),
      scraper: resolveScraper(run),
      objectiveRaw: run.objective_raw,
      fixtureSet: run.fixture_set,
    };

    if (resolveRunner(run) === "agent-sdk") await runAgentSdk({ supabase, run: runState, model: resolveModel(run), shouldStop, session });
    else await runGeminiAgent({ supabase, run: runState, model: resolveModel(run), shouldStop, session });

    const stillMissing = await missingParts(supabase, lead.id);
    const status = stillMissing.length === 0 ? "done" : "failed";
    await finishDraftRequest(supabase, request.id, status, status === "failed" ? `Couldn't finish: ${stillMissing.join(", ")} still missing.` : null);
    return { claimed: true, requestId: request.id, status };
  } catch (err) {
    await finishDraftRequest(supabase, request.id, "failed", errorMessage(err)).catch((e) => console.error(`failed to mark draft request ${request.id} failed:`, e));
    if (!request.replay_mode) await sendDiscord("alerts", draftingFailedMessage({ runId: request.run_id, leadId: request.lead_id, message: errorMessage(err) }));
    return { claimed: true, requestId: request.id, status: "failed" };
  }
}
