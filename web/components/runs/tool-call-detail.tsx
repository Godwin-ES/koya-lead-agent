import type { ReactNode } from "react";
import { StatusBadge } from "@/components/primitives/status-badge";
import { UntrustedContent } from "@/components/leads/untrusted-content";
import { LEAD_STATUS } from "@core/domain/status";
import type { ToolCallRow } from "@core/db/row-types";

/**
 * What a click on a timeline row actually shows - the real structured
 * data every handler already computed (packages/core/src/tools/log.ts's
 * `invoke()` now persists it as `result_data`, not just the one-line
 * summary). One renderer per tool, since "strictly useful" means showing
 * what that specific call actually did, not a generic JSON dump.
 */
export function ToolCallDetail({ call }: { call: ToolCallRow }) {
  const data = call.result_data as Record<string, unknown> | unknown[] | null;

  if (call.status === "denied") {
    return <p className="text-sm text-[var(--color-danger-text)]">{call.denial_reason}</p>;
  }
  if (call.status === "error") {
    return <p className="text-sm text-[var(--color-danger-text)]">{call.error_message}</p>;
  }
  if (!data) {
    return <p className="text-sm text-[var(--color-text-muted)]">No additional detail recorded for this call.</p>;
  }

  switch (call.tool_name) {
    case "save_icp":
      return <IcpDetail icp={data as Record<string, unknown>} />;
    case "request_clarification":
      return <p className="text-sm text-[var(--color-text)]">{String((data as Record<string, unknown>).question)}</p>;
    case "discover_companies":
      return <CandidateListDetail candidates={data as Array<Record<string, unknown>>} />;
    case "scrape_site":
      return <ScrapeDetail result={data as Record<string, unknown>} />;
    case "save_lead":
      return <LeadDetail lead={data as Record<string, unknown>} />;
    case "save_outreach":
      return <DraftDetail draft={data as Record<string, unknown>} />;
    case "list_run_state":
      return <RunStateDetail summary={data as Record<string, unknown>} />;
    case "finalize_run":
      return <FinalizeDetail run={data as Record<string, unknown>} />;
    default:
      return <pre className="whitespace-pre-wrap text-xs text-[var(--color-text-muted)]">{JSON.stringify(data, null, 2)}</pre>;
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-0.5 text-sm text-[var(--color-text)]">{children}</div>
    </div>
  );
}

function ListField({ label, items }: { label: string; items: unknown }) {
  const arr = Array.isArray(items) ? (items as string[]) : [];
  if (arr.length === 0) return null;
  return (
    <Field label={label}>
      <ul className="list-disc space-y-0.5 pl-4">
        {arr.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    </Field>
  );
}

function IcpDetail({ icp }: { icp: Record<string, unknown> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Target company type">{String(icp.target_company_type ?? "-")}</Field>
      <Field label="Headcount range">{String(icp.headcount_range ?? "-")}</Field>
      <Field label="Buyer persona">{String(icp.buyer_persona ?? "-")}</Field>
      <Field label="Business problem">{String(icp.business_problem ?? "-")}</Field>
      <ListField label="Industries" items={icp.industries} />
      <ListField label="Geography" items={icp.geography} />
      <ListField label="Hard filters" items={icp.hard_filters} />
      <ListField label="Soft preferences" items={icp.soft_preferences} />
      <ListField label="Disqualifiers" items={icp.disqualifiers} />
    </div>
  );
}

function CandidateListDetail({ candidates }: { candidates: Array<Record<string, unknown>> }) {
  if (candidates.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No candidates in this batch.</p>;
  }
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {candidates.map((c, i) => (
          <li key={i} className="flex items-baseline justify-between gap-2 border-b border-[var(--color-border)] py-1 text-sm last:border-b-0">
            <span className="text-[var(--color-text)]">{String(c.companyName ?? "Unknown")}</span>
            <span className="truncate text-xs text-[var(--color-text-muted)]">{String(c.companyDomain ?? "")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScrapeDetail({ result }: { result: Record<string, unknown> }) {
  if (result.success === false) {
    return <p className="text-sm text-[var(--color-danger-text)]">{String(result.errorMessage)}</p>;
  }
  return (
    <div className="space-y-2">
      {result.injectionFlagged === true && (
        <p className="text-xs font-medium text-[var(--color-warning-text)]">Injection attempt flagged in this page&apos;s content.</p>
      )}
      <UntrustedContent url={String(result.finalUrl ?? result.url ?? "")} text={String(result.contentMd ?? "")} />
    </div>
  );
}

function LeadDetail({ lead }: { lead: Record<string, unknown> }) {
  const status = String(lead.qualification_status ?? "needs_review") as keyof typeof LEAD_STATUS;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusBadge entry={LEAD_STATUS[status]} />
        {typeof lead.confidence === "number" && (
          <span className="text-xs text-[var(--color-text-muted)]">{Math.round(lead.confidence * 100)}% confidence</span>
        )}
      </div>
      <ListField label="Fit reasons" items={lead.fit_reasons} />
      <ListField label="Concerns" items={lead.concerns} />
      {typeof lead.source_summary === "string" && lead.source_summary && <Field label="Source summary">{lead.source_summary}</Field>}
    </div>
  );
}

function DraftDetail({ draft }: { draft: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      <Field label={`${String(draft.channel ?? "email")} - step ${String(draft.step ?? 1)}`}>
        {typeof draft.subject === "string" && draft.subject && <p className="font-medium">{draft.subject}</p>}
        <p className="whitespace-pre-wrap">{String(draft.body ?? "")}</p>
      </Field>
      {typeof draft.personalization_note === "string" && draft.personalization_note && (
        <Field label="Personalization note">{draft.personalization_note}</Field>
      )}
    </div>
  );
}

function RunStateDetail({ summary }: { summary: Record<string, unknown> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Field label="Qualified">{String(summary.qualified_count ?? 0)}</Field>
      <Field label="Needs review">{String(summary.needs_review_count ?? 0)}</Field>
      <Field label="Not qualified">{String(summary.not_qualified_count ?? 0)}</Field>
      <Field label="Tool calls">{String(summary.tool_call_count ?? 0)}</Field>
    </div>
  );
}

function FinalizeDetail({ run }: { run: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      <Field label="Final status">{String(run.status ?? "-")}</Field>
      {typeof run.partial_reason === "string" && run.partial_reason && <Field label="Reason">{run.partial_reason}</Field>}
      {typeof run.failure_reason === "string" && run.failure_reason && <Field label="Failure reason">{run.failure_reason}</Field>}
    </div>
  );
}
