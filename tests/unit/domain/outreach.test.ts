import { describe, expect, it } from "vitest";
import { checkDraft, checkEditedDraft, composeEmailBody, composeLinkedInBody, shortCompanyName, toTitleCase, LINKEDIN_MAX_CHARS, type DraftCheckInput } from "@core/domain/outreach";

const EMAIL_1 =
  "NextStage gives government contractors federal procurement data, pipeline tracking and AI-assisted proposals in one place, which puts your team close to a lot of document-heavy work.\n\n" +
  "At Koya Talent we place trained AI automation assistants inside teams to take on repetitive work like preparing first-pass compliance matrices.\n\n" +
  "Is that kind of support something your team has considered?";

const base: DraftCheckInput = {
  channel: "email",
  step: 1,
  subject: "proposal prep at NextStage",
  content: EMAIL_1,
  evidence: "AI-Powered Proposal Suite with compliance matrix (nextstage.ai)",
  companyName: "NextStage",
  companyDomain: "nextstage.ai",
};

describe("composing drafts", () => {
  it("opens with Good day and signs with the sender and Koya Talent", () => {
    expect(composeEmailBody("  Body.  ", "Jordan Reyes")).toBe("Good day,\n\nBody.\n\nBest,\nJordan Reyes\nKoya Talent");
  });

  it("signs as the team when no display name is set", () => {
    expect(composeEmailBody("Body.", null)).toBe("Good day,\n\nBody.\n\nBest,\nThe Koya Talent team");
  });

  it("gives a LinkedIn message the greeting and no sign-off", () => {
    expect(composeLinkedInBody("NextStage's proposal suite caught my eye.")).toBe("Good day, NextStage's proposal suite caught my eye.");
  });

  it("drops legal suffixes when checking for the company name", () => {
    expect(shortCompanyName("mindzie, inc.")).toBe("mindzie");
    expect(shortCompanyName("Platform Engineering Labs Inc.")).toBe("Platform Engineering Labs");
  });

  // Live: the check demanded "Everflow - Partner Marketing Platform" in every email.
  it("drops the LinkedIn tagline after a dash, pipe or colon, but not a hyphen inside the name", () => {
    expect(shortCompanyName("Everflow - Partner Marketing Platform")).toBe("Everflow");
    expect(shortCompanyName("G2X | GovCon GTM Platform")).toBe("G2X");
    expect(shortCompanyName("Olibr – Free Job Community Platform")).toBe("Olibr");
    expect(shortCompanyName("Sub-Zero Group")).toBe("Sub-Zero Group");
  });

  it("puts subjects in Title Case, keeping acronyms, mixed-case names and domains as written", () => {
    expect(toTitleCase("financial intelligence workflows at Financiario")).toBe("Financial Intelligence Workflows at Financiario");
    expect(toTitleCase("first-pass compliance for SaaS teams")).toBe("First-Pass Compliance for SaaS Teams");
    expect(toTitleCase("a note on nextstage.ai pipelines")).toBe("A Note on nextstage.ai Pipelines");
    expect(toTitleCase("AI support for G2X")).toBe("AI Support for G2X");
    expect(toTitleCase("what the team is working on")).toBe("What the Team Is Working On");
  });
});

describe("checkDraft", () => {
  it("accepts a specific, well-formed email 1", () => {
    expect(checkDraft(base)).toEqual([]);
  });

  it("requires a real subject on every email step - they're separate emails, not replies", () => {
    expect(checkDraft({ ...base, step: 3, subject: "", content: "If the timing is wrong for NextStage, just say so and I won't follow up again. Happy to pick this up later." })).toEqual([
      expect.stringMatching(/Email step 3 needs its own subject line/),
    ]);
    expect(checkDraft({ ...base, subject: "Re: proposal prep" })).toContainEqual(expect.stringMatching(/pretends to be a reply/));
    expect(checkDraft({ ...base, subject: "a thought about how your proposal team at NextStage works" })).toContainEqual(expect.stringMatching(/too long/));
    expect(checkDraft({ ...base, subject: "Unlock faster proposals" })).toContainEqual(expect.stringMatching(/"unlock"/));
  });

  it("keeps each step inside its length", () => {
    expect(checkDraft({ ...base, content: `${EMAIL_1} ${"More detail about NextStage. ".repeat(20)}` })).toContainEqual(expect.stringMatching(/words - keep it under 130/));
    expect(checkDraft({ ...base, content: "NextStage, Koya Talent can help." })).toContainEqual(expect.stringMatching(/needs at least 40/));
  });

  it("keeps a LinkedIn message within LinkedIn's limit, greeting included, with no subject", () => {
    const long = `NextStage ${"x".repeat(LINKEDIN_MAX_CHARS)}`;
    expect(checkDraft({ ...base, channel: "linkedin", subject: undefined, content: long })).toContainEqual(expect.stringMatching(/LinkedIn allows 300/));
    expect(checkDraft({ ...base, channel: "linkedin", subject: "hi", content: "NextStage's proposal suite looks useful." })).toContainEqual(expect.stringMatching(/no subject/));
  });

  it("rejects markdown, exclamation marks and stock phrases", () => {
    const problems = checkDraft({ ...base, content: `${EMAIL_1}\n\n**Let's leverage this!**` });
    expect(problems).toContainEqual(expect.stringMatching(/plain text/));
    expect(problems).toContainEqual(expect.stringMatching(/exclamation/));
    expect(problems).toContainEqual(expect.stringMatching(/"leverage"/));
  });

  it("requires the company by name, except in the brief final email", () => {
    const generic = EMAIL_1.split("NextStage").join("Your company");
    expect(checkDraft({ ...base, content: generic })).toContainEqual(expect.stringMatching(/Refer to NextStage by name/));
    expect(checkDraft({ ...base, step: 3, content: "If the timing is off, just let me know and I will leave it there. Glad to talk whenever it suits." })).toEqual([]);
  });

  it("requires the evidence to name its source on the company's own site", () => {
    expect(checkDraft({ ...base, evidence: "Their proposal suite" })).toContainEqual(expect.stringMatching(/include the URL on nextstage\.ai/));
  });
});

describe("checkEditedDraft (a reviewer's own edit)", () => {
  it("only blocks what the database would reject - an empty message or an email with no subject", () => {
    expect(checkEditedDraft({ channel: "email", subject: "", body: "Good day,\n\nBody.\n\nBest,\nJordan Reyes\nKoya Talent" }).blocking).toEqual(["Every email needs a subject line."]);
    expect(checkEditedDraft({ channel: "linkedin", subject: null, body: "  " }).blocking).toEqual(["The message can't be empty."]);
  });

  it("flags placeholders, stock phrases, markdown and LinkedIn length as warnings, not blockers", () => {
    const result = checkEditedDraft({ channel: "email", subject: "hello", body: "Good day [Name],\n\n**Let us leverage** this.\n\nBest,\nJordan Reyes" });
    expect(result.blocking).toEqual([]);
    expect(result.warnings).toEqual([expect.stringMatching(/placeholder: \[Name\]/), expect.stringMatching(/"leverage"/), expect.stringMatching(/markdown/)]);
    expect(checkEditedDraft({ channel: "linkedin", subject: null, body: "x".repeat(301) }).warnings).toEqual([expect.stringMatching(/301 characters/)]);
  });

  it("doesn't mistake the signature for a problem", () => {
    expect(checkEditedDraft({ channel: "email", subject: "acme scheduling", body: "Good day,\n\nAcme runs clinics.\n\nBest,\nJordan Reyes\nKoya Talent" })).toEqual({ blocking: [], warnings: [] });
  });
});
