/**
 * Worker entry point: boot-time credential validation, the health
 * server, the claim/heartbeat loop, a periodic reclaim_stale_runs sweep,
 * and graceful shutdown on SIGTERM (Task 16).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" }); // no-ops harmlessly in a real deployment, where env vars are injected directly, not read from a file

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { reclaimStaleRuns } from "@core/db/runs";
import { validateBootCredentials, runClaimLoop } from "./service";
import { startHealthServer } from "./health";

const WORKER_ID = process.env.WORKER_ID ?? `worker-${randomUUID()}`;
const HEALTH_PORT = Number(process.env.PORT ?? 8080);
const RECLAIM_INTERVAL_MS = 30_000;

async function main() {
  await validateBootCredentials();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const healthServer = startHealthServer(HEALTH_PORT);
  console.log(`${WORKER_ID} listening for runs (health on :${HEALTH_PORT}).`);

  const reclaimTimer = setInterval(() => {
    reclaimStaleRuns(supabase).catch((err) => console.error("reclaim_stale_runs failed:", err));
  }, RECLAIM_INTERVAL_MS);

  let shuttingDown = false;
  const claimLoop = runClaimLoop(supabase, WORKER_ID, {
    isShuttingDown: () => shuttingDown,
  });

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    console.log(`${WORKER_ID} received ${signal}, finishing the current tool call and requeueing any run in flight...`);
    shuttingDown = true;
    clearInterval(reclaimTimer);
    await claimLoop;
    healthServer.close();
    console.log(`${WORKER_ID} exited cleanly.`);
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await claimLoop;
}

main().catch((err) => {
  console.error("worker failed to start:", err);
  process.exit(1);
});
