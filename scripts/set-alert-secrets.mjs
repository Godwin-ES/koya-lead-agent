/**
 * Stores the worker-down watchdog's secrets (migration 027) in Supabase
 * Vault, from the environment: DISCORD_ALERTS_WEBHOOK_URL and APP_URL.
 * Run it once per environment, e.g. at deploy:
 *
 *   node scripts/set-alert-secrets.mjs          # set or update both
 *   node scripts/set-alert-secrets.mjs --clear  # turn the watchdog off
 *
 * Reads .env.local when present; prints no secret values.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
if (existsSync(".env.local")) require("dotenv").config({ path: ".env.local", quiet: true });
const pg = require("pg");

const clear = process.argv.includes("--clear");
const secrets = { discord_alerts_webhook: process.env.DISCORD_ALERTS_WEBHOOK_URL ?? "", app_url: process.env.APP_URL ?? "" };
if (!clear && !secrets.discord_alerts_webhook) {
  console.error("DISCORD_ALERTS_WEBHOOK_URL is not set - nothing to store.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const [name, value] of Object.entries(secrets)) {
    const existing = await client.query("select id from vault.secrets where name = $1", [name]);
    if (clear) {
      if (existing.rows[0]) await client.query("delete from vault.secrets where id = $1", [existing.rows[0].id]);
      console.log(`${name}: cleared`);
    } else if (existing.rows[0]) {
      await client.query("select vault.update_secret($1, $2)", [existing.rows[0].id, value]);
      console.log(`${name}: updated`);
    } else {
      await client.query("select vault.create_secret($1, $2)", [value, name]);
      console.log(`${name}: stored`);
    }
  }
} finally {
  await client.end();
}
