import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { anonClientAs, createTestUser, dbClient, serviceRoleClient } from "../helpers/db.js";

/**
 * SYSTEM-DESIGN-NEXTJS.md §15 / §16: RLS on every table, scoped through
 * `runs.user_id`. Uses two real Supabase Auth users and the anon key, not
 * the raw postgres connection - RLS only applies to roles PostgREST
 * actually authenticates as, so this is the only way to prove it holds.
 */
describe("row level security", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  let db: Client;
  let ownerRunId: string;
  let ownerLeadId: string;

  beforeAll(async () => {
    owner = await createTestUser();
    other = await createTestUser();

    db = dbClient();
    await db.connect();

    const run = await db.query<{ id: string }>(
      `insert into runs (user_id, objective_raw, status) values ($1, $2, 'draft') returning id`,
      [owner.userId, "Find 10 US B2B SaaS companies"],
    );
    ownerRunId = run.rows[0]!.id;

    const lead = await db.query<{ id: string }>(
      `insert into leads (run_id, company_name, company_domain, qualification_status, confidence, source_urls, fit_reasons)
       values ($1, 'Acme', 'acme.example', 'qualified', 0.8, $2, $3) returning id`,
      [ownerRunId, ["https://acme.example"], ["fits"]],
    );
    ownerLeadId = lead.rows[0]!.id;

    await db.query(
      `insert into tool_calls (run_id, seq, tool_name, status) values ($1, 1, 'discover_companies', 'ok')`,
      [ownerRunId],
    );

    // Real content_md is irrelevant to RLS visibility, so a placeholder
    // is fine - only `url` needs to match `leads.source_urls` for the
    // owned row, and deliberately not for the unrelated one.
    await db.query(
      `insert into scrape_cache (url_hash, url, scraper, content_md) values ($1, $2, 'crawl4ai', $3)`,
      ["owned-test-hash", "https://acme.example", "# Acme\nPlaceholder content."],
    );
    await db.query(
      `insert into scrape_cache (url_hash, url, scraper, content_md) values ($1, $2, 'crawl4ai', $3)`,
      ["unrelated-test-hash", "https://unrelated.example", "# Unrelated\nNo lead references this."],
    );
  });

  afterAll(async () => {
    await db.query("delete from scrape_cache where url_hash in ('owned-test-hash', 'unrelated-test-hash')");
    await db.query("delete from runs where id = $1", [ownerRunId]);
    await db.end();
    await owner.cleanup();
    await other.cleanup();
  });

  it("lets the owner read their own run", async () => {
    const client = anonClientAs(owner.accessToken);
    const { data, error } = await client.from("runs").select("id").eq("id", ownerRunId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("does not let a second user read the first user's run", async () => {
    const client = anonClientAs(other.accessToken);
    const { data, error } = await client.from("runs").select("id").eq("id", ownerRunId);
    expect(error).toBeNull(); // RLS filters rows silently; it isn't a query error
    expect(data).toHaveLength(0);
  });

  it("does not let a second user read the first user's leads", async () => {
    const client = anonClientAs(other.accessToken);
    const { data, error } = await client.from("leads").select("id").eq("id", ownerLeadId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("lets the owner read their own leads via the run relationship", async () => {
    const client = anonClientAs(owner.accessToken);
    const { data, error } = await client.from("leads").select("id").eq("id", ownerLeadId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("lets the owner read scraped content for one of their own leads' source urls (the evidence drawer, §17.9)", async () => {
    const client = anonClientAs(owner.accessToken);
    const { data, error } = await client.from("scrape_cache").select("url").eq("url", "https://acme.example");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("does not let a second user read scraped content tied to the first user's lead", async () => {
    const client = anonClientAs(other.accessToken);
    const { data, error } = await client.from("scrape_cache").select("url").eq("url", "https://acme.example");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("does not expose a scrape_cache row that no owned lead's source_urls references", async () => {
    const client = anonClientAs(owner.accessToken);
    const { data, error } = await client.from("scrape_cache").select("url").eq("url", "https://unrelated.example");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("lets the owner read the tool-call log for their own run (the evidence UI, §17.7)", async () => {
    const client = anonClientAs(owner.accessToken);
    const { data, error } = await client.from("tool_calls").select("id").eq("run_id", ownerRunId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("does not let a second user read the first user's tool-call log", async () => {
    const client = anonClientAs(other.accessToken);
    const { data, error } = await client.from("tool_calls").select("id").eq("run_id", ownerRunId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("does not let an authenticated user insert directly into leads (worker-only write via service_role)", async () => {
    const client = anonClientAs(owner.accessToken);
    const { error } = await client.from("leads").insert({
      run_id: ownerRunId,
      company_name: "Sneaky Co",
      company_domain: "sneaky.example",
      qualification_status: "qualified",
      confidence: 0.9,
      source_urls: ["https://sneaky.example"],
      fit_reasons: ["x"],
    });
    expect(error).not.toBeNull();
  });

  it("lets service_role read across every user's runs (the worker's own access)", async () => {
    const admin = serviceRoleClient();
    const { data, error } = await admin.from("runs").select("id").eq("id", ownerRunId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("does not let an unauthenticated request read any run", async () => {
    const client = anonClientAs("");
    const { data } = await client.from("runs").select("id").eq("id", ownerRunId);
    expect(data ?? []).toHaveLength(0);
  });
});
