import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    // Integration tests share one live external resource (the linked
    // Supabase project) and exercise genuinely global state - most
    // pointedly claim_next_run(), which by design grabs the oldest
    // queued run across the whole table with no per-test scoping,
    // because that's exactly what it needs to do in production. Running
    // test *files* in parallel (Vitest's default) let files race each
    // other's rows the same way two real workers would, which is a
    // correctness bug in the test harness, not in claim_next_run itself.
    // Sequential file execution costs some wall-clock time; it's a fair
    // trade for tests that don't intermittently fail on each other.
    fileParallelism: false,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/contract/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@core": path.resolve(rootDir, "packages/core/src"),
    },
  },
});
