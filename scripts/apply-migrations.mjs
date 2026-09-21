#!/usr/bin/env node
/**
 * Applies every SQL file in supabase/migrations/, in filename order,
 * against SUPABASE_DB_URL - tracked in a `schema_migrations` table so a
 * rerun only applies what's new (safe to run more than once, per the
 * participant guide).
 *
 * The Supabase CLI's own migration runner needs a local Docker stack
 * (`supabase start`) that this project doesn't use - see
 * BUILD-NOTES-NEXTJS.md's "linked cloud project, not a local stack" entry
 * for why. This script is the plain-SQL equivalent, scoped to exactly
 * what this project needs.
 */
import { config as loadEnv } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(appDir, ".env.local") });

const migrationsDir = path.join(appDir, "supabase/migrations");

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("SUPABASE_DB_URL is not set (see .env.example).");
    process.exit(1);
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows: appliedRows } = await client.query("select filename from schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.filename));

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(path.join(migrationsDir, file), "utf-8");
      console.log(`apply ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        appliedCount++;
      } catch (err) {
        await client.query("rollback");
        console.error(`FAILED ${file}:`, err.message);
        process.exit(1);
      }
    }

    console.log(appliedCount === 0 ? "Nothing to apply." : `Applied ${appliedCount} migration(s).`);
  } finally {
    await client.end();
  }
}

main();
