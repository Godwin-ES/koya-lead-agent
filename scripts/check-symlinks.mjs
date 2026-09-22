#!/usr/bin/env node
/**
 * Guards against the recurring pnpm symlink-resolution bug documented in
 * BUILD-NOTES-NEXTJS.md (Task 7, recurred again in Task 10): pnpm
 * occasionally links packages/core's peer-dependency-qualified packages
 * (currently @anthropic-ai/sdk and @google/genai, both peer-qualified on
 * zod elsewhere in the workspace) to a store path that was never actually
 * fetched. `pnpm install`, even `--force`, does not self-heal it. Run as
 * part of `pnpm check` so a broken symlink fails loudly with the exact
 * fix, instead of resurfacing as a confusing three-layers-deep
 * "Cannot find module" or "Invalid hook call".
 *
 * Uses `lstatSync` to detect the symlink itself (not `existsSync`, which
 * FOLLOWS a symlink and returns false for a dangling one - the exact
 * failure mode this guard exists to catch. An `existsSync`-gated version
 * of this script silently skipped every broken link it was meant to
 * catch, confirmed when this exact bug recurred a fourth time (Task 14)
 * right after this guard had just reported "Symlinks OK.".
 */
import { realpathSync, lstatSync } from "node:fs";

const CHECKS = [
  { link: "packages/core/node_modules/@anthropic-ai/sdk" },
  { link: "packages/core/node_modules/@google/genai" },
  { link: "packages/core/node_modules/apify-client" },
];

let failed = false;

for (const { link } of CHECKS) {
  try {
    lstatSync(link); // throws if nothing is there at all - a different problem, not this one
  } catch {
    continue;
  }
  try {
    realpathSync(link);
  } catch {
    console.error(`Broken symlink: ${link} points at a store path that does not exist.`);
    console.error(`This is the pnpm symlink-resolution bug in BUILD-NOTES-NEXTJS.md (Task 7/10).`);
    console.error(`Fix: find the real store entry and relink it, e.g.:`);
    console.error(`  ls node_modules/.pnpm | grep <package-name>`);
    console.error(`  ln -sf ../../../../node_modules/.pnpm/<real-entry>/node_modules/<pkg> ${link}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("Symlinks OK.");
