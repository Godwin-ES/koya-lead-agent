import Link from "next/link";
import { ChevronRight, ShieldAlert, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/primitives/empty-state";
import type { LeadQualificationStatus } from "@core/domain/types";
import type { LeadRow } from "@core/db/row-types";
import { confidenceLabel } from "@core/schemas/qualification";

export interface LeadListItem {
  lead: LeadRow;
}

const SEGMENTS: Array<{ status: LeadQualificationStatus; label: string; empty: string }> = [
  { status: "qualified", label: "Qualified", empty: "No qualified leads yet." },
  { status: "needs_review", label: "Needs review", empty: "Nothing needs review - every lead has a clear decision." },
  { status: "not_qualified", label: "Not qualified", empty: "No leads were ruled out." },
];

/** The one line that explains the decision: why it fits, or what stood in the way. */
function reasonLine(lead: LeadRow): string {
  if (lead.decided_by === "reviewer" && lead.review_reason) return `Your decision: ${lead.review_reason}`;
  if (lead.qualification_status === "qualified") return lead.fit_reasons[0] ?? "Qualified.";
  return lead.evidence_gap_reason || lead.concerns[0] || lead.source_summary || "No reason recorded.";
}

export function LeadList({ runId, items, active }: { runId: string; items: LeadListItem[]; active: LeadQualificationStatus }) {
  const counts = Object.fromEntries(SEGMENTS.map((s) => [s.status, items.filter((i) => i.lead.qualification_status === s.status).length]));
  const visible = items.filter((i) => i.lead.qualification_status === active).sort((a, b) => b.lead.confidence - a.lead.confidence);
  const segment = SEGMENTS.find((s) => s.status === active)!;

  return (
    <div className="space-y-4">
      <nav aria-label="Lead decisions" className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
        {SEGMENTS.map((s) => (
          <Link
            key={s.status}
            href={`/runs/${runId}/leads?status=${s.status}`}
            aria-current={s.status === active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              s.status === active ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {s.label} <span className="tabular-nums text-[var(--color-text-muted)]">{counts[s.status]}</span>
          </Link>
        ))}
      </nav>

      {visible.length === 0 ? (
        <EmptyState title={segment.empty} description={items.length === 0 ? "Leads appear here as the agent qualifies candidates." : "Other decisions are in the tabs above."} />
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {visible.map(({ lead }) => (
            <li key={lead.id}>
              <Link href={`/runs/${runId}/leads/${lead.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--color-surface-2)]">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--color-text)]">{lead.company_name}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{lead.company_domain}</span>
                    {lead.decided_by === "reviewer" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                        <UserCheck className="h-3 w-3" aria-hidden="true" />
                        Decided by you
                      </span>
                    )}
                    {lead.injection_flagged && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-xs text-[var(--color-danger-text)]">
                        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                        Injection flagged
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-[var(--color-text-muted)]">{reasonLine(lead)}</p>
                </div>
                <div className="hidden shrink-0 text-right text-xs tabular-nums text-[var(--color-text-muted)] sm:block">{confidenceLabel(lead.qualification_status, lead.confidence)}</div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
