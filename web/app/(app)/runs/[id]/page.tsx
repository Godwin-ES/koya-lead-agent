import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRunById } from "@core/db/runs";
import { listToolCallsForRun } from "@core/db/tool-calls";
import { listAgentEventsForRun } from "@core/db/events";
import { listCostForRun } from "@core/db/cost";
import { listLeadsForRun } from "@core/db/leads";
import { RunView } from "./run-view";

export default async function RunPage(props: PageProps<"/runs/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const run = await getRunById(supabase, id);
  if (!run) notFound();

  const [toolCalls, agentEvents, costLedger, leads] = await Promise.all([
    listToolCallsForRun(supabase, id),
    listAgentEventsForRun(supabase, id),
    listCostForRun(supabase, id),
    listLeadsForRun(supabase, id),
  ]);

  let hasDrafts = false;
  if (leads.length > 0) {
    const { count } = await supabase
      .from("outreach_drafts")
      .select("id", { count: "exact", head: true })
      .in(
        "lead_id",
        leads.map((l) => l.id),
      );
    hasDrafts = (count ?? 0) > 0;
  }

  return (
    <RunView
      runId={id}
      initial={{ run, toolCalls, agentEvents, costLedger }}
      hasIcp={run.icp !== null}
      hasLeads={leads.length > 0}
      hasDrafts={hasDrafts}
    />
  );
}
