import { describe, expect, it } from "vitest";
import { layoutSummary } from "@core/domain/summary-layout";

// A real finalize summary from a live Sonnet 5 run, shortened: one run-on paragraph.
const LIVE =
  "Completed resumed run. ICP: US B2B SaaS software companies. Final results - 6 qualified leads (exceeds target of 5), each with full 4-part outreach drafts: 1. AdeptForms - enterprise forms SaaS. 2. IgniteTech - AI-first enterprise software company. 3. HackerEarth - technical recruiting platform used by enterprises like Google. 4. nOps - cloud cost optimization platform managing $5B+ spend. 5. Odie (formerly Totango) - customer-success platform. 6. Clockworks Analytics - fault-detection platform for facilities teams. 4 leads saved as needs_review: Paystack, Syntasa. No personal contact information was sought.";

describe("layoutSummary", () => {
  it("splits a run-on summary's numbered list into its own items", () => {
    const blocks = layoutSummary(LIVE);
    expect(blocks[0]).toEqual({ kind: "paragraph", text: expect.stringContaining("Final results - 6 qualified leads") });
    expect(blocks[1]).toMatchObject({ kind: "numbered" });
    const items = (blocks[1] as { items: string[] }).items;
    expect(items).toHaveLength(6);
    expect(items[0]).toBe("AdeptForms - enterprise forms SaaS.");
    expect(items[3]).toBe("nOps - cloud cost optimization platform managing $5B+ spend.");
    expect(items[5]).toBe("Clockworks Analytics - fault-detection platform for facilities teams.");
    expect(blocks[2]).toEqual({ kind: "paragraph", text: "4 leads saved as needs_review: Paystack, Syntasa. No personal contact information was sought." });
  });

  it("keeps a laid-out summary's paragraphs and bullets", () => {
    const blocks = layoutSummary("Found 5 of 5.\n\nQualified:\n- Acme - billing SaaS\n- Beta - scheduling SaaS\n\nNothing was sent.");
    expect(blocks).toEqual([
      { kind: "paragraph", text: "Found 5 of 5." },
      { kind: "paragraph", text: "Qualified:" },
      { kind: "bullets", items: ["Acme - billing SaaS", "Beta - scheduling SaaS"] },
      { kind: "paragraph", text: "Nothing was sent." },
    ]);
  });

  it("leaves plain prose alone, including numbers that aren't a list", () => {
    expect(layoutSummary("Used 3 searches and 2. Nothing else.")).toEqual([{ kind: "paragraph", text: "Used 3 searches and 2. Nothing else." }]);
  });
});
