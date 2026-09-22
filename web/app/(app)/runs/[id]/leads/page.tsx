import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRunById } from "@core/db/runs";
import { listLeadsForRun } from "@core/db/leads";
import { LeadTable } from "@/components/leads/lead-table";

export default async function LeadsPage(props: PageProps<"/runs/[id]/leads">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const run = await getRunById(supabase, id);
  if (!run) notFound();

  const leads = await listLeadsForRun(supabase, id);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-[var(--color-text)]">Leads</h1>
      <p className="mb-4 truncate text-sm text-[var(--color-text-muted)]">{run.objective_raw}</p>
      <LeadTable runId={id} leads={leads} />
    </div>
  );
}
