import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fixtures live under tests/fixtures/, resolved by walking up from this
 * module's own location to the workspace root (marked by
 * pnpm-workspace.yaml), not from process.cwd(). A bare process.cwd()
 * assumption broke silently in production: Vitest and Playwright are
 * both invoked from the app/ workspace root, so it worked for every test
 * run - but `next start` (via `pnpm --filter web start`) actually runs
 * with cwd = app/web/, not app/. Every classifier call under the real
 * server process was silently resolving to a nonexistent
 * app/web/tests/fixtures/ path, "fixture missing" was swallowed by
 * objective.ts's own try/catch, and the objective validation gate
 * quietly degraded to "unavailable" on every single call - confirmed by
 * an E2E test that expected a "vague" verdict and got "unavailable"
 * instead, with no error surfaced anywhere in between.
 */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to cwd if the marker can't be found (e.g. an unusual
  // deployment layout) - better than throwing outright.
  return process.cwd();
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = findWorkspaceRoot(moduleDir);

function fixturesRoot(): string {
  return path.join(workspaceRoot, "tests/fixtures");
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
