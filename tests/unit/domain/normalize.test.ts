import { describe, expect, it } from "vitest";
import { normalizeDomain, hashObjective } from "@core/domain/normalize";

// SYSTEM-DESIGN-NEXTJS.md §14: normalized domains are lowercase, protocol
// stripped, "www." stripped, path/query/fragment/port stripped.
describe("normalizeDomain", () => {
  it("collapses a decorated URL and a bare domain to the same key", () => {
    expect(normalizeDomain("HTTPS://WWW.Foo.com/pricing")).toBe(normalizeDomain("foo.com"));
    expect(normalizeDomain("foo.com")).toBe("foo.com");
  });

  it("strips protocol, www, path, query, and port", () => {
    expect(normalizeDomain("http://www.Example.com:8080/about?ref=x#top")).toBe("example.com");
  });

  it("leaves a subdomain that is not www intact", () => {
    expect(normalizeDomain("https://app.example.com")).toBe("app.example.com");
  });

  it("is idempotent", () => {
    const once = normalizeDomain("HTTPS://WWW.Foo.com/pricing");
    expect(normalizeDomain(once)).toBe(once);
  });
});

// SYSTEM-DESIGN-NEXTJS.md §7.1: "Classifier results are cached by a hash of
// the normalized objective, so editing unrelated form fields, retyping, or a
// failed submit does not re-spend the call."
describe("hashObjective", () => {
  it("produces the same hash for objectives differing only in case or whitespace", () => {
    const a = hashObjective("Find 10 US B2B SaaS companies");
    const b = hashObjective("  find   10 us b2b saas companies  ");
    expect(a).toBe(b);
  });

  it("produces different hashes for genuinely different objectives", () => {
    expect(hashObjective("Find 10 US B2B SaaS companies")).not.toBe(
      hashObjective("Find 10 UK fintech companies"),
    );
  });

  it("is deterministic across calls", () => {
    const text = "Find 10 US B2B SaaS companies with 10 to 100 employees";
    expect(hashObjective(text)).toBe(hashObjective(text));
  });
});
