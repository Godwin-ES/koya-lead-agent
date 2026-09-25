import { afterEach, describe, expect, it, vi } from "vitest";
import { isProduction, productionRunConfig } from "@core/domain/environment";
import { isReplayMode } from "@core/providers/replay/recorder";

describe("production environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is only production with APP_ENV=production - a local production build isn't", () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(false);
    vi.stubEnv("APP_ENV", "production");
    expect(isProduction()).toBe(true);
  });

  // The trap: an unset REPLAY_MODE used to mean replay everywhere, so a deploy that forgot it would replay recordings.
  it("runs live in production unless replay is asked for explicitly", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("REPLAY_MODE", "");
    expect(isReplayMode()).toBe(false);
    vi.stubEnv("REPLAY_MODE", "true");
    expect(isReplayMode()).toBe(true);
  });

  it("keeps replay as the local default", () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "");
    vi.stubEnv("REPLAY_MODE", "");
    expect(isReplayMode()).toBe(true);
  });

  it("always runs Claude with Firecrawl in production, on the configured model", () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5");
    expect(productionRunConfig()).toEqual({ runner: "agent-sdk", model: "claude-sonnet-5", scraper: "firecrawl" });
  });
});
