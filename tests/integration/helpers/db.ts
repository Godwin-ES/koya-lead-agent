import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type QueryResultRow } from "pg";
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
