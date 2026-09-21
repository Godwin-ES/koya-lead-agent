import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Fixtures live under tests/fixtures/, resolved from process.cwd() rather
 * than import.meta.url - both Vitest and Playwright are always invoked
 * from the app/ workspace root (see the same choice, and why, in
 * tests/integration/helpers/db.ts).
 */
function fixturesRoot(): string {
  return path.join(process.cwd(), "tests/fixtures");
}

/**
 * Turns a call key into a stable, reviewable file path. A colon in the
 * key becomes a directory separator (e.g. "apify:discover:<hash>" ->
 * tests/fixtures/apify/discover/<hash>.json) so fixtures for one provider
 * sit together instead of as a flat list of colon-separated filenames,
 * which some filesystems disallow in a bare filename anyway.
 */
export function fixturePathFor(key: string): string {
  const segments = key.split(":").map((segment) => segment.replace(/[^a-zA-Z0-9_.-]/g, "_"));
  return path.join(fixturesRoot(), ...segments) + ".json";
}

export function fixtureExists(key: string): boolean {
  return existsSync(fixturePathFor(key));
}

export function loadFixture<T>(key: string): T {
  const filePath = fixturePathFor(key);
  if (!existsSync(filePath)) {
    throw new Error(
      `fixture missing: no recorded fixture for "${key}" at ${filePath}. Record it first with REPLAY_MODE=false.`,
    );
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export function saveFixture<T>(key: string, value: T): void {
  const filePath = fixturePathFor(key);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}
