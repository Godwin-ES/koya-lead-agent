import { afterEach, describe, expect, it, vi } from "vitest";
import { runCompletedMessage, runFailedMessage, runStoppedShortMessage, sendDiscord, toDiscordPayload, type RunOutcome } from "@core/notify/discord";

const outcome: RunOutcome = {
  runId: "run-1",
  objective: "Find US B2B SaaS companies with 10 to 100 employees that may need AI automation support.",
  qualified: 5,
  needsReview: 2,
  target: 5,
  costUsd: 1.123,
  durationMs: 9 * 60_000,
};

describe("discord messages", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sums a completed run up in one line and links to the leads needing review", () => {
    vi.stubEnv("APP_URL", "https://koya.example/");
    const payload = toDiscordPayload(runCompletedMessage(outcome)) as { embeds: Array<{ title: string; url: string }> };
    expect(payload.embeds[0]!.title).toBe("✅ Run completed: 5 of 5 qualified · 2 need review · $1.12 · 9 min");
    expect(payload.embeds[0]!.url).toBe("https://koya.example/runs/run-1/leads");
  });

  it("says why a run stopped short and how to continue", () => {
    const message = runStoppedShortMessage({ ...outcome, qualified: 3, needsReview: 0 }, {
      limit_reached: "searches", qualified: 3, target: 5, searches_used: 3, searches_limit: 3, kept: 20, undecided: 0,
      scrapes_used: 20, scrape_limit: 60, candidates_seen: 30, candidate_limit: 30, turns_used: 60, max_turns: 150, tool_calls_used: 70, max_tool_calls: 400,
    });
    expect(message.title).toBe("⚠️ Run stopped short: 3 of 5 qualified · $1.12 · 9 min");
    expect(message.description).toMatch(/all 3 of 3 searches were used/);
    expect(message.description).toMatch(/Continue with more budget/);
  });

  it("tells a temporary failure it'll resume, and an account problem what to fix", () => {
    const temporary = runFailedMessage({ runId: "r", objective: "x", kind: "temporary", provider: "anthropic", message: "Claude is overloaded (overloaded).", resumeInMs: 120_000 });
    expect(temporary.title).toBe("🔁 Temporary problem (Claude)");
    expect(temporary.description).toMatch(/Resuming automatically in 2 min/);
    const account = runFailedMessage({ runId: "r", objective: "x", kind: "account", provider: "firecrawl", message: "Firecrawl is out of credits", resumeInMs: null });
    expect(account.title).toBe("🔑 Account problem (Firecrawl)");
    expect(account.description).toMatch(/Fix the account, then press Resume/);
  });

  it("never lets a message ping @everyone", () => {
    expect(toDiscordPayload(runCompletedMessage({ ...outcome, objective: "@everyone look" }))).toMatchObject({ allowed_mentions: { parse: [] } });
  });

  it("sends nothing when the webhook isn't set", async () => {
    vi.stubEnv("DISCORD_RUNS_WEBHOOK_URL", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await sendDiscord("runs", runCompletedMessage(outcome))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws when Discord is unreachable", async () => {
    vi.stubEnv("DISCORD_ALERTS_WEBHOOK_URL", "https://discord.example/webhook");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendDiscord("alerts", runCompletedMessage(outcome))).resolves.toBe(false);
  });
});
