import { fixtureExists, loadFixture, saveFixture } from "./fixtures";
import { isProduction } from "../../domain/environment";

/**
 * Wraps every external call in the project - Apify, Crawl4AI, Firecrawl,
 * and every Claude/Gemini call (SYSTEM-DESIGN-NEXTJS.md §11: "Every
 * external call goes through a recorder - including model calls").
 *
 * Defaults to replay mode when `REPLAY_MODE` is unset, not just when it's
 * explicitly "true" - the safe default is never accidentally live. Only
 * an explicit `REPLAY_MODE=false` allows a real call through (and then
 * records its result as the fixture for next time).
 *
 * A missing fixture in replay mode is a loud, explicit error, never a
 * silent fall-through to a live call - a fall-through would spend real
 * money the moment a fixture is missing during an automated test run.
 *
 * In production (APP_ENV=production) it's the other way round: live unless
 * REPLAY_MODE=true, so a deploy that forgets the setting does real work
 * instead of silently replaying recordings. And nothing is recorded there -
 * a recording holds scraped pages and lead data, and belongs to tests.
 */
export function isReplayMode(): boolean {
  if (isProduction()) return process.env.REPLAY_MODE === "true";
  return process.env.REPLAY_MODE !== "false";
}

export async function withRecording<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (isReplayMode()) {
    return loadFixture<T>(key);
  }

  const result = await fn();
  if (!isProduction()) saveFixture(key, result);
  return result;
}

export { fixtureExists, loadFixture, saveFixture };
