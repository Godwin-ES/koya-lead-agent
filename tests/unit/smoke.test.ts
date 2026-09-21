import { describe, expect, it } from "vitest";
import { APP_NAME } from "@core/domain/status";

describe("application foundation", () => {
  it("exposes the Week 5 product name", () => {
    expect(APP_NAME).toBe("Koya Lead Agent");
  });
});
