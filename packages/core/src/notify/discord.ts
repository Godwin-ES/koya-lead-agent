/**
 * Discord notifications. Two channels: `runs` for the moments someone needs
 * to know or act (a run finished, stopped short, or is waiting for an
 * answer) and `alerts` for failures and outages. One message per event,
 * with a link to the page to act on - never lead details, drafts, scraped
 * text, keys, names or email addresses.
 *
 * Webhook URLs are secrets from the environment (DISCORD_RUNS_WEBHOOK_URL,
 * DISCORD_ALERTS_WEBHOOK_URL); APP_URL builds the links. Sending never
 * throws - a failed notification must never break a run - and is skipped
 * when the webhook isn't set (tests, local development without it).
 */
import type { StopDetails } from "../tools/finish-check";
import { stopReasonText } from "../tools/finish-check";
import { providerLabel, type FailureKind, type FailureProvider } from "../domain/failure";

export type DiscordChannel = "runs" | "alerts";

export interface DiscordMessage {
  title: string;
  description?: string;
  /** Where the message's title links to, relative to APP_URL ("/runs/<id>"). */
  path?: string;
  color: number;
}

const COLOR = { success: 0x2e7d32, warning: 0xf9a825, info: 0x1565c0, danger: 0xc62828 } as const;

function webhookFor(channel: DiscordChannel): string | undefined {
  return channel === "runs" ? process.env.DISCORD_RUNS_WEBHOOK_URL : process.env.DISCORD_ALERTS_WEBHOOK_URL;
}

export function appLink(path: string): string | undefined {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : undefined;
}

/** The embed Discord receives - exported so tests can check exactly what would be sent. */
export function toDiscordPayload(message: DiscordMessage): Record<string, unknown> {
  const url = message.path ? appLink(message.path) : undefined;
  return {
    // No @everyone/@here pings from anything interpolated into a message.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: message.title.slice(0, 256),
        ...(message.description ? { description: message.description.slice(0, 2000) } : {}),
        ...(url ? { url } : {}),
        color: message.color,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export async function sendDiscord(channel: DiscordChannel, message: DiscordMessage): Promise<boolean> {
  const webhook = webhookFor(channel);
  if (!webhook) return false;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toDiscordPayload(message)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`discord ${channel} notification failed: HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error(`discord ${channel} notification failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

// ---------------------------------------------------------------------
// The messages. Pure, so tests can check wording and what's left out.
// ---------------------------------------------------------------------

export interface RunOutcome {
  runId: string;
  objective: string;
  qualified: number;
  needsReview: number;
  target: number;
  costUsd: number;
  durationMs: number | null;
}

function shortObjective(objective: string): string {
  const oneLine = objective.replace(/\s+/g, " ").trim();
  return oneLine.length > 90 ? `${oneLine.slice(0, 87)}…` : oneLine;
}

function formatDuration(ms: number | null): string | null {
  if (ms === null || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "under a minute" : `${minutes} min`;
}

function outcomeLine(o: RunOutcome): string {
  const parts = [
    `${o.qualified} of ${o.target} qualified`,
    o.needsReview > 0 ? `${o.needsReview} need${o.needsReview === 1 ? "s" : ""} review` : null,
    `$${o.costUsd.toFixed(2)}`,
    formatDuration(o.durationMs),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function runCompletedMessage(o: RunOutcome): DiscordMessage {
  return {
    title: `✅ Run completed: ${outcomeLine(o)}`,
    description: shortObjective(o.objective),
    path: o.needsReview > 0 ? `/runs/${o.runId}/leads` : `/runs/${o.runId}`,
    color: COLOR.success,
  };
}

export function runStoppedShortMessage(o: RunOutcome, stop: StopDetails | null): DiscordMessage {
  return {
    title: `⚠️ Run stopped short: ${outcomeLine(o)}`,
    description: `${shortObjective(o.objective)}\n${stop ? `Stopped because ${stopReasonText(stop)}` : ""} "Continue with more budget" on the run page carries on from here.`.trim(),
    path: `/runs/${o.runId}`,
    color: COLOR.warning,
  };
}

export function awaitingInputMessage(runId: string, objective: string, question: string): DiscordMessage {
  return {
    title: "❓ A run needs your answer to continue",
    description: `${shortObjective(objective)}\n> ${question.replace(/\s+/g, " ").slice(0, 300)}`,
    path: `/runs/${runId}`,
    color: COLOR.info,
  };
}

const KIND_HEADLINE: Record<FailureKind, string> = {
  account: "Account problem",
  temporary: "Temporary problem",
  bug: "Run failed",
};

export function runFailedMessage(args: { runId: string; objective: string; kind: FailureKind; provider: FailureProvider | null; message: string; resumeInMs: number | null }): DiscordMessage {
  const who = args.provider ? ` (${providerLabel(args.provider)})` : "";
  const next =
    args.resumeInMs !== null
      ? `Resuming automatically in ${Math.round(args.resumeInMs / 60_000)} min.`
      : args.kind === "account"
        ? "Fix the account, then press Resume on the run page."
        : args.kind === "temporary"
          ? "The automatic retries are used up - press Resume on the run page once it's back."
          : "Press Resume on the run page to try again; if it fails the same way, it needs a fix.";
  return {
    title: `${args.resumeInMs !== null ? "🔁" : args.kind === "account" ? "🔑" : "❌"} ${KIND_HEADLINE[args.kind]}${who}`,
    description: `${shortObjective(args.objective)}\n${args.message.slice(0, 600)}\n\n${next}`,
    path: `/runs/${args.runId}`,
    color: args.resumeInMs !== null ? COLOR.warning : COLOR.danger,
  };
}

export function draftingFailedMessage(args: { runId: string; leadId: string; message: string }): DiscordMessage {
  return {
    title: "❌ Drafting outreach failed for a lead",
    description: `${args.message.slice(0, 600)}\n\nPress "Draft outreach" on the lead again to retry.`,
    path: `/runs/${args.runId}/leads/${args.leadId}`,
    color: COLOR.danger,
  };
}

export function objectiveCheckDownMessage(): DiscordMessage {
  return {
    title: "🔑 The objective check is unavailable",
    description: "New runs can't start until it's back - the check to Claude (Haiku) failed twice in a row. Check the Anthropic status and account.",
    path: "/runs/new",
    color: COLOR.danger,
  };
}

export function workerOnlineMessage(workerId: string): DiscordMessage {
  return { title: "🟢 Worker online", description: `Worker ${workerId} started and is taking runs.`, color: COLOR.info };
}
