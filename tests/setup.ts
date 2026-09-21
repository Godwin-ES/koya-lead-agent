import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts sets `globals: false` deliberately (explicit imports
// over ambient test globals), so React Testing Library's own auto-cleanup
// - which detects Jest-style globals - never registers. Without this,
// each React component test's rendered tree stays mounted into the next
// test in the same file, and later `getByRole` queries start matching
// more than one element.
afterEach(() => {
  cleanup();
});
