import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRunById } from "@core/db/runs";
import { listLeadsForRun } from "@core/db/leads";
import { LeadList } from "@/components/review/lead-list";
import type { LeadQualificationStatus } from "@core/domain/types";

const STATUSES: readonly LeadQualificationStatus[] = ["qualified", "needs_review", "not_qualified"];

export default async function LeadsPage(props: PageProps<"/runs/[id]/leads">) {
  const { id } = await props.params;
  const requested = (await props.searchParams).status;
  const supabase = await createClient();

  const run = await getRunById(supabase, id);
  if (!run) notFound();

  const items = (await listLeadsForRun(supabase, id)).map((lead) => ({ lead }));

  // Open where the decisions need attention: explicit ?status=, else qualified, else whatever exists.
  const active =
    STATUSES.find((s) => s === requested) ?? STATUSES.find((s) => items.some((i) => i.lead.qualification_status === s)) ?? "qualified";

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-lg font-semibold text-[var(--color-text)]">Leads</h1>
      <p className="mb-4 text-sm text-[var(--color-text-muted)]">{run.objective_raw}</p>
      <LeadList runId={id} items={items} active={active} />
    </div>
  );
}
