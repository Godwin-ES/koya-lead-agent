import { describe, expect, it } from "vitest";
import {
  candidatesPerDiscoverCall,
  normalizeHarvestItem,
  prefilterCandidate,
  resolveIndustries,
  sizeBucketsFor,
  validateSearchKeyword,
  type NormalizedCandidate,
} from "@core/domain/discovery";

/** Shape copied from a real harvestapi/linkedin-company-search item (live probe, BUILD-NOTES-NEXTJS.md). */
function rawItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "89556771",
    universalName: "beesblaze-software-solutions-inc",
    linkedinUrl: "https://www.linkedin.com/company/beesblaze-software-solutions-inc/",
    name: "Beesblaze Software Solutions INC",
    tagline: "It's always seems impossible until it's done...",
    website: "https://www.beesblaze.com/",
    foundedOn: { month: null, year: 2016, day: null },
    employeeCount: 15,
    employeeCountRange: { start: 51, end: 200 },
    description: "Offshore IT services.",
    companyType: "Privately Held",
    locations: [
      {
        country: "US",
        city: "San Francisco",
        geographicArea: "California",
        headquarter: true,
        parsed: { text: "San Francisco, CA, United States", countryCode: "US", country: "United States", state: "California", city: "San Francisco" },
      },
    ],
    specialities: ["staffing", "software"],
    industries: [{ id: "96", name: "IT Services and IT Consulting", urn: "urn:li:fsd_industryV2:96" }],
    similarOrganizations: [{ id: "5039110", name: "Should never become a candidate" }],
    peopleStats: [{ statTitle: "Locations", values: [] }],
    _meta: { pagination: { totalResultCount: 1000 } },
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}): NormalizedCandidate {
  const c = normalizeHarvestItem(rawItem(overrides));
  if (!c) throw new Error("fixture failed to normalize");
  return c;
}

const US_10_TO_100 = { headcount_min: 10, headcount_max: 100, locations: ["United States"] };

describe("resolveIndustries", () => {
  it("resolves exact labels case-insensitively, and numeric codes", () => {
    expect(resolveIndustries(["software development", "6"]).resolved).toEqual([
      { id: "4", label: "Software Development" },
      { id: "6", label: "Technology, Information and Internet" },
    ]);
  });

  it("returns close real labels for an unknown one instead of guessing", () => {
    const { resolved, unknown } = resolveIndustries(["SaaS Software"]);
    expect(resolved).toEqual([]);
    expect(unknown[0]!.input).toBe("SaaS Software");
    expect(unknown[0]!.suggestions).toContain("Software Development");
  });

  it("does not duplicate a code given twice", () => {
    expect(resolveIndustries(["Software Development", "4"]).resolved).toHaveLength(1);
  });
});

describe("sizeBucketsFor", () => {
  it("maps a headcount range to every LinkedIn bucket it overlaps", () => {
    expect(sizeBucketsFor(10, 100)).toEqual(["1-10", "11-50", "51-200"]);
    expect(sizeBucketsFor(50, 200)).toEqual(["11-50", "51-200"]);
    expect(sizeBucketsFor(null, 50)).toEqual(["1-10", "11-50"]);
    expect(sizeBucketsFor(5000, null)).toEqual(["1001-5000", "5001-10000", "10001+"]);
  });

  it("applies no size filter when there's no bound", () => {
    expect(sizeBucketsFor(null, null)).toEqual([]);
  });
});

describe("normalizeHarvestItem", () => {
  it("keeps the fields qualification uses and drops similarOrganizations and peopleStats", () => {
    const c = candidate();
    expect(c).toMatchObject({
      linkedinId: "89556771",
      name: "Beesblaze Software Solutions INC",
      domain: "beesblaze.com",
      employeeCount: 15,
      employeeCountRange: { start: 51, end: 200 },
      industries: [{ id: "96", name: "IT Services and IT Consulting" }],
      foundedYear: 2016,
    });
    expect(c.locations[0]).toMatchObject({ country: "United States", countryCode: "US", headquarter: true });
    expect(JSON.stringify(c)).not.toContain("similarOrganizations");
    expect(JSON.stringify(c)).not.toContain("Should never become a candidate");
    expect(JSON.stringify(c)).not.toContain("peopleStats");
  });

  it("keeps an open-ended range open-ended", () => {
    expect(candidate({ employeeCountRange: { start: 10001, end: null } }).employeeCountRange).toEqual({ start: 10001, end: null });
  });

  it("returns a null domain when LinkedIn has no website", () => {
    expect(candidate({ website: null }).domain).toBeNull();
  });
});

describe("prefilterCandidate: size (the self-reported range decides)", () => {
  it("passes when the range overlaps the required headcount", () => {
    expect(prefilterCandidate(candidate(), US_10_TO_100).size.status).toBe("pass");
  });

  it("fails when the range is entirely outside it", () => {
    const r = prefilterCandidate(candidate({ employeeCountRange: { start: 201, end: 500 }, employeeCount: 327 }), US_10_TO_100);
    expect(r.size.status).toBe("fail");
    expect(r.status).toBe("fail");
  });

  // Live: Platform Engineering Labs (2-10) was qualified for a 10-100 objective on this overlap.
  it("needs review when the range only touches the required headcount at its edge", () => {
    const r = prefilterCandidate(candidate({ employeeCountRange: { start: 2, end: 10 }, employeeCount: 4 }), US_10_TO_100);
    expect(r.size.status).toBe("needs_review");
    expect(r.size.reason).toMatch(/only touches the required 10-100 at 10/);
    expect(prefilterCandidate(candidate({ employeeCountRange: { start: 11, end: 50 } }), { ...US_10_TO_100, headcount_min: 50, headcount_max: 200 }).size.status).toBe("needs_review");
  });

  it("still passes a range that genuinely overlaps (51-200 against 10-100)", () => {
    expect(prefilterCandidate(candidate({ employeeCountRange: { start: 51, end: 200 } }), US_10_TO_100).size.status).toBe("pass");
  });

  it("needs review when LinkedIn has no range", () => {
    expect(prefilterCandidate(candidate({ employeeCountRange: null }), US_10_TO_100).size.status).toBe("needs_review");
  });

  // Real probe data: IPsoft showed employeeCount 504 in a 51-200 range.
  it("records a large member-count mismatch as a concern without changing the verdict", () => {
    const r = prefilterCandidate(candidate({ employeeCount: 504 }), US_10_TO_100);
    expect(r.size.status).toBe("pass");
    expect(r.concerns).toHaveLength(1);
    expect(r.concerns[0]).toMatch(/504/);
  });

  it("does not flag a member count within 2x of the range", () => {
    expect(prefilterCandidate(candidate({ employeeCount: 40 }), US_10_TO_100).concerns).toEqual([]);
  });
});

describe("prefilterCandidate: location", () => {
  const hq = (parsed: Record<string, unknown>, headquarter = true) => ({ headquarter, parsed });

  it("passes on a matching headquarters, including country aliases", () => {
    expect(prefilterCandidate(candidate(), US_10_TO_100).location.status).toBe("pass");
    expect(prefilterCandidate(candidate(), { ...US_10_TO_100, locations: ["USA"] }).location.status).toBe("pass");
    expect(prefilterCandidate(candidate(), { ...US_10_TO_100, locations: ["California"] }).location.status).toBe("pass");
  });

  it("fails when the only location is a headquarters elsewhere", () => {
    const c = candidate({ locations: [hq({ text: "Berlin, Germany", country: "Germany", countryCode: "DE" })] });
    expect(prefilterCandidate(c, US_10_TO_100).location.status).toBe("fail");
  });

  it("needs review for a foreign headquarters with a US office", () => {
    const c = candidate({
      locations: [hq({ text: "Seoul, South Korea", country: "South Korea", countryCode: "KR" }), hq({ text: "New York, NY, United States", country: "United States", countryCode: "US" }, false)],
    });
    expect(prefilterCandidate(c, US_10_TO_100).location.status).toBe("needs_review");
  });

  it("needs review when no location or no headquarters is marked", () => {
    expect(prefilterCandidate(candidate({ locations: [] }), US_10_TO_100).location.status).toBe("needs_review");
    const noHq = candidate({ locations: [hq({ text: "Austin, TX, United States", country: "United States", countryCode: "US" }, false)] });
    expect(prefilterCandidate(noHq, US_10_TO_100).location.status).toBe("needs_review");
  });
});

describe("prefilterCandidate: overall", () => {
  it("drops a company with no website - nothing to scrape and no source URL", () => {
    const r = prefilterCandidate(candidate({ website: null }), US_10_TO_100);
    expect(r.status).toBe("fail");
    expect(r.dropReason).toMatch(/website/i);
  });

  it("is needs_review when any check is, and nothing fails", () => {
    expect(prefilterCandidate(candidate({ employeeCountRange: null }), US_10_TO_100).status).toBe("needs_review");
  });
});

describe("validateSearchKeyword", () => {
  const locations = ["United States"];

  it("sends back words for what Koya Talent sells - the live 'workflow automation' search found vendors", () => {
    for (const k of ["workflow automation", "AI", "AI-powered", "automation tools", "RPA", "agentic"]) {
      expect(validateSearchKeyword(k, locations), k).toMatch(/what Koya Talent sells/);
    }
  });

  it("accepts short product and domain nouns", () => {
    for (const k of ["platform", "payments", "HR software", "digital health", "api"]) {
      expect(validateSearchKeyword(k, locations), k).toBeNull();
    }
  });

  // A/B probe: this exact query returned 0 results at 11-200 employees and vendors at 1-10.
  it("rejects criteria words, which match vendors serving those companies", () => {
    expect(validateSearchKeyword("Series A SaaS", locations)).toMatch(/criteria words \(series\)/);
    expect(validateSearchKeyword("b2b payments", locations)).toMatch(/b2b/);
    expect(validateSearchKeyword("fintech startups", locations)).toMatch(/startups/);
  });

  it("rejects more than three words", () => {
    expect(validateSearchKeyword("cloud based workforce scheduling tools", locations)).toMatch(/at most 3/);
  });

  // A/B probe: "SaaS" returned SaaS Solutions / SaaS Direct / SaaS Adviser - service firms named after the category.
  it("rejects a bare category word on its own", () => {
    expect(validateSearchKeyword("SaaS", locations)).toMatch(/named/);
    expect(validateSearchKeyword("saas software", locations)).toMatch(/named/);
  });

  it("rejects geography, which the filters already apply", () => {
    expect(validateSearchKeyword("us payroll", locations)).toMatch(/location words \(us\)/);
  });
});

describe("candidatesPerDiscoverCall", () => {
  it("is 2x the target within [10, 25]", () => {
    expect(candidatesPerDiscoverCall(1)).toBe(10);
    expect(candidatesPerDiscoverCall(8)).toBe(16);
    expect(candidatesPerDiscoverCall(10)).toBe(20);
    expect(candidatesPerDiscoverCall(50)).toBe(25);
  });
});
