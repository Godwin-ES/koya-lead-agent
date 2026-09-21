import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool, type QueryResultRow } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Loaded here, not globally, so unit/contract tests never need real
// secrets and this file is the one place that knows where .env.local is.
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: path.join(appDir, ".env.local") });

/**
 * A direct Postgres connection as the `postgres` owner role. Used for
 * schema-level tests (CHECK constraints, triggers, unique indexes) that
 * have nothing to do with Supabase Auth or RLS - this connection bypasses
 * RLS entirely, same as `service_role` would, which is correct for
 * asserting what the database itself refuses regardless of who's asking.
 */
export function dbClient(): Client {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Integration tests need a real Supabase project - see .env.example.",
    );
  }
  return new Client({ connectionString, ssl: { rejectUnauthorized: false } });
}

/**
 * A real connection pool, for tests that need genuine server-side
 * concurrency (e.g. proving an advisory lock actually serializes
 * concurrent callers). A single `Client` isn't enough for that - `pg`
 * queues queries sent to one `Client` internally and sends them one at a
 * time, so firing many queries at a lone Client "concurrently" from JS
 * never actually contends on the server; it just works by accident
 * (and logs a deprecation warning for calling `.query()` while one is
 * already in flight). A `Pool` genuinely dispatches concurrent queries
 * over separate connections.
 */
export function dbPool(maxConnections = 6): Pool {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is not set.");
  }
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: maxConnections });
}

export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = dbClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Runs a query and throws with Postgres's own message on failure - callers assert on that message. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  client: Client,
  sql: string,
  params: unknown[] = [],
) {
  return client.query<T>(sql, params);
}

/**
 * A `service_role` Supabase client - bypasses RLS, same as the worker.
 * Used to seed fixtures and, for RLS tests, to provision throwaway auth
 * users via the admin API.
 */
export function serviceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * An anon-key Supabase client authenticated as a specific throwaway user -
 * this is what a real browser session looks like to RLS, unlike
 * `dbClient()` above which bypasses it entirely.
 */
export function anonClientAs(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.");
  }
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Inserts a minimal run row directly (bypassing RLS via the raw `pg`
 * connection), for RPC tests that need a run to exist without caring how
 * it got there. Returns its id.
 */
export async function insertTestRun(
  client: Client,
  userId: string,
  overrides: Partial<{
    status: string;
    queued_at: string | null;
    heartbeat_at: string | null;
    worker_id: string | null;
    attempt: number;
    limits: Record<string, unknown>;
  }> = {},
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into runs (user_id, objective_raw, status, queued_at, heartbeat_at, worker_id, attempt, limits)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      userId,
      "Find 10 US B2B SaaS companies with 10 to 100 employees",
      overrides.status ?? "draft",
      overrides.queued_at ?? null,
      overrides.heartbeat_at ?? null,
      overrides.worker_id ?? null,
      overrides.attempt ?? 0,
      JSON.stringify(overrides.limits ?? { target_qualified: 10 }),
    ],
  );
  return result.rows[0]!.id;
}

/**
 * Creates a throwaway confirmed auth user for an RLS test and returns a
 * signed-in access token for it, plus a teardown function. Test-only users
 * are tagged with a `test-` email prefix and a random UUID so parallel
 * runs never collide and cleanup is unambiguous.
 */
export async function createTestUser() {
  const admin = serviceRoleClient();
  const email = `test-${randomUUID()}@example.invalid`;
  const password = randomUUID();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`Failed to create test user: ${createError?.message}`);
  }

  const { data: signedIn, error: signInError } = await admin.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.session) {
    throw new Error(`Failed to sign in test user: ${signInError?.message}`);
  }

  return {
    userId: created.user.id,
    accessToken: signedIn.session.access_token,
    async cleanup() {
      await admin.auth.admin.deleteUser(created.user.id);
    },
  };
}
