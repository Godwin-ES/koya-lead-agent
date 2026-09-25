import { describe, expect, it } from "vitest";
import { HistoryTrimmer } from "../../../worker/src/runners/history-trim";
type History = ConstructorParameters<typeof HistoryTrimmer>[0];
type Content = History[number];

function responseTurn(name: string, output: string): Content {
  return { role: "user", parts: [{ functionResponse: { name, response: { output } } }] };
}

function outputAt(history: Content[], index: number): string {
  return String(history[index]!.parts![0]!.functionResponse!.response!.output);
}

/** Pushes one tool response onto the history and tells the trimmer about it, the way the runner does. */
function step(history: Content[], trimmer: HistoryTrimmer, toolName: string, args: Record<string, unknown>, data: unknown, output = `${toolName} output`): number {
  history.push(responseTurn(toolName, output));
  const index = history.length - 1;
  trimmer.recordTurn(index, [{ toolName, args, data, partIndex: 0 }]);
  return index;
}

const lead = (id: string, domain: string, status: string) => ({ id, company_domain: domain, qualification_status: status });
const draft = (leadId: string, channel: string, step: number) => ({ lead_id: leadId, channel, step });

describe("HistoryTrimmer", () => {
  it("trims a page as soon as its company is saved as not_qualified or needs_review", () => {
    const history: Content[] = [];
    const trimmer = new HistoryTrimmer(history);
    const page = step(history, trimmer, "scrape_site", { url: "https://agency.example" }, { candidateDomain: "agency.example" }, "FULL PAGE TEXT");

    expect(outputAt(history, page)).toBe("FULL PAGE TEXT");
    step(history, trimmer, "save_lead", {}, lead("l1", "agency.example", "not_qualified"));

    expect(outputAt(history, page)).toMatch(/^\[Page text for https:\/\/agency\.example removed.*saved as not_qualified/);
  });

  it("keeps a qualified lead's page until all three emails and the LinkedIn message are saved", () => {
    const history: Content[] = [];
    const trimmer = new HistoryTrimmer(history);
    const page = step(history, trimmer, "scrape_site", { url: "https://acme.example" }, { candidateDomain: "acme.example" }, "FULL PAGE TEXT");
    step(history, trimmer, "save_lead", {}, lead("l1", "acme.example", "qualified"));
    step(history, trimmer, "save_outreach", {}, draft("l1", "email", 1));
    step(history, trimmer, "save_outreach", {}, draft("l1", "email", 2));
    step(history, trimmer, "save_outreach", {}, draft("l1", "email", 3));

    expect(outputAt(history, page)).toBe("FULL PAGE TEXT");

    step(history, trimmer, "save_outreach", {}, draft("l1", "linkedin", 1));
    expect(outputAt(history, page)).toMatch(/saved as qualified and its outreach is drafted/);
  });

  it("does not trim one company's page because of another company's lead", () => {
    const history: Content[] = [];
    const trimmer = new HistoryTrimmer(history);
    const page = step(history, trimmer, "scrape_site", { url: "https://acme.example" }, { candidateDomain: "acme.example" }, "ACME PAGE");
    step(history, trimmer, "save_lead", {}, lead("l2", "other.example", "not_qualified"));

    expect(outputAt(history, page)).toBe("ACME PAGE");
  });

  it("trims a discovery result only once every company it kept has a saved lead", () => {
    const history: Content[] = [];
    const trimmer = new HistoryTrimmer(history);
    const discovery = step(history, trimmer, "discover_companies", {}, { candidates: [{ domain: "a.example" }, { domain: "b.example" }] }, "CANDIDATE LIST");

    step(history, trimmer, "save_lead", {}, lead("l1", "a.example", "qualified"));
    expect(outputAt(history, discovery)).toBe("CANDIDATE LIST");

    step(history, trimmer, "save_lead", {}, lead("l2", "https://www.b.example/", "needs_review"));
    expect(outputAt(history, discovery)).toBe("[Discovery result removed from this conversation - every company it kept now has a saved lead: a.example (qualified), b.example (needs_review).]");
  });
});
