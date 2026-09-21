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
 */
import { realpathSync, existsSync } from "node:fs";
import path from "node:path";

const CHECKS = [
  { link: "packages/core/node_modules/@anthropic-ai/sdk" },
  { link: "packages/core/node_modules/@google/genai" },
];

let failed = false;

for (const { link } of CHECKS) {
  if (!existsSync(link)) continue; // not installed at all - a different problem, not this one
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
