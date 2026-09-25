import { describe, expect, it } from "vitest";
import { derivePipeline, type PipelineToolCall } from "@core/domain/pipeline";

const call = (tool_name: string, result_data: unknown, status = "ok"): PipelineToolCall => ({ tool_name, status, result_data });
const discovery = (itemCount: number, kept: number) => call("discover_companies", { search: {}, itemCount, candidates: Array.from({ length: kept }, () => ({})), dropped: [] });
const lead = (company_domain: string, qualification_status: string) => call("save_lead", { company_domain, qualification_status });

describe("derivePipeline", () => {
  it("adds up discovery, kept, scraped companies and lead outcomes across the run", () => {
    const p = derivePipeline([
      discovery(20, 20),
      discovery(20, 18),
      call("scrape_site", { candidateDomain: "a.example", url: "https://a.example" }),
      call("scrape_site", { candidateDomain: "a.example", url: "https://a.example/pricing" }),
      call("scrape_site", { candidateDomain: "b.example", url: "https://b.example" }),
      lead("a.example", "qualified"),
      lead("b.example", "needs_review"),
      lead("c.example", "not_qualified"),
    ]);
    expect(p).toEqual({ discovered: 40, kept: 38, scraped: 2, qualified: 1, needsReview: 1, notQualified: 1 });
  });

  it("counts a re-saved lead once, by its latest decision", () => {
    const p = derivePipeline([lead("a.example", "needs_review"), lead("https://www.a.example/", "qualified")]);
    expect(p).toMatchObject({ qualified: 1, needsReview: 0 });
  });

  it("counts a reviewer's decision over the agent's", () => {
    const p = derivePipeline([lead("a.example", "needs_review"), lead("b.example", "qualified")], 0, { "a.example": "qualified", "b.example": "not_qualified" });
    expect(p).toMatchObject({ qualified: 1, needsReview: 0, notQualified: 1 });
  });

  it("ignores calls that errored or were denied", () => {
    const p = derivePipeline([call("discover_companies", { search: {}, itemCount: 20, candidates: [{}], dropped: [] }, "error"), call("save_lead", { company_domain: "a.example", qualification_status: "qualified" }, "denied")]);
    expect(p).toMatchObject({ discovered: 0, qualified: 0 });
  });

  it("shows no kept count for runs whose discovery predates the prefilter, and falls back to the old counter", () => {
    expect(derivePipeline([call("discover_companies", [{ companyName: "Old" }, { companyName: "Older" }])])).toMatchObject({ discovered: 2, kept: null });
    expect(derivePipeline([], 13)).toMatchObject({ discovered: 13, kept: null });
  });
});
