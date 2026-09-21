import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
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
