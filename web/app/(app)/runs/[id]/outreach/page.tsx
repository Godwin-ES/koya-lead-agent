import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { getRunById } from "@core/db/runs";
import { listLeadsForRun } from "@core/db/leads";
import { listLatestDraftRequests } from "@core/db/draft-requests";
import { EmptyState } from "@/components/primitives/empty-state";
import { OutreachEditor } from "@/components/review/outreach-editor";
import type { OutreachDraftRow } from "@core/db/row-types";

export default async function OutreachPage(props: PageProps<"/runs/[id]/outreach">) {
  const { id } = await props.params;
  const requestedLead = (await props.searchParams).lead;
  const supabase = await createClient();

  const run = await getRunById(supabase, id);
  if (!run) notFound();

  const qualified = (await listLeadsForRun(supabase, id)).filter((l) => l.qualification_status === "qualified");
  if (qualified.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-4 text-lg font-semibold text-[var(--color-text)]">Outreach</h1>
        <EmptyState
          title="No qualified leads yet"
          description="Outreach is drafted for qualified leads. Once the agent qualifies one - or you qualify one from the Leads tab - its emails and LinkedIn message appear here to review."
        />
      </div>
    );
  }

  const [{ data }, requests] = await Promise.all([
    supabase.from("outreach_drafts").select().in("lead_id", qualified.map((l) => l.id)),
    listLatestDraftRequests(supabase, id),
  ]);
  const drafts = (data ?? []) as OutreachDraftRow[];

  const index = Math.max(0, qualified.findIndex((l) => l.id === requestedLead));
  const lead = qualified[index]!;
  const prev = qualified[index - 1];
  const next = qualified[index + 1];
  const own = drafts.filter((d) => d.lead_id === lead.id);

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
      <aside aria-label="Qualified leads" className="lg:sticky lg:top-0 lg:self-start">
        <h1 className="mb-3 text-lg font-semibold text-[var(--color-text)]">Outreach</h1>
        <ul className="space-y-1">
          {qualified.map((l) => {
            const ld = drafts.filter((d) => d.lead_id === l.id);
            const approved = ld.filter((d) => d.approved_at).length;
            const active = l.id === lead.id;
            return (
              <li key={l.id}>
                <Link
                  href={`/runs/${id}/outreach?lead=${l.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cn("block rounded-md px-3 py-2 text-sm", active ? "bg-[var(--color-surface-2)]" : "hover:bg-[var(--color-surface-2)]")}
                >
                  <span className="block truncate font-medium text-[var(--color-text)]">{l.company_name}</span>
                  <span className={cn("text-xs", ld.length < 4 ? "text-[var(--color-warning-text)]" : "text-[var(--color-text-muted)]")}>
                    {ld.length}/4 drafted · {approved}/{ld.length} approved
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      <section aria-labelledby="outreach-lead" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="outreach-lead" className="text-xl font-semibold text-[var(--color-text)]">
              {lead.company_name}
            </h2>
            <Link href={`/runs/${id}/leads/${lead.id}?tab=evidence`} className="text-sm text-[var(--color-text-muted)] hover:underline">
              {lead.company_domain} · see the evidence
            </Link>
          </div>
          <div className="flex items-center gap-1 text-sm">
            {prev ? (
              <Link href={`/runs/${id}/outreach?lead=${prev.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-[var(--color-surface-2)]">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </Link>
            ) : null}
            <span className="px-1 tabular-nums text-[var(--color-text-muted)]">
              {index + 1} of {qualified.length}
            </span>
            {next ? (
              <Link href={`/runs/${id}/outreach?lead=${next.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-[var(--color-surface-2)]">
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
        <OutreachEditor leadId={lead.id} qualified drafts={own} request={requests.get(lead.id) ?? null} />
      </section>
    </div>
  );
}
