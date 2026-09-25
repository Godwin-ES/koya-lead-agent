import type { ReactNode } from "react";
import { StatusBadge } from "@/components/primitives/status-badge";
import { UntrustedContent } from "@/components/leads/untrusted-content";
import { LEAD_STATUS } from "@core/domain/status";
import type { ToolCallRow } from "@core/db/row-types";
import { confidenceLabel } from "@core/schemas/qualification";

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
  if (call.status === "sent_back") {
    const reasons = ((data as { reasons?: unknown } | null)?.reasons ?? []) as string[];
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Sent back to the agent to fix</p>
        <ul className="list-disc space-y-0.5 pl-4 text-sm text-[var(--color-text)]">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-[var(--color-text-muted)]">No additional detail recorded for this call.</p>;
  }

  switch (call.tool_name) {
    case "save_icp": {
      const d = data as Record<string, unknown>;
      // Older runs stored the ICP object itself; newer ones store { icp, discovery_filters }.
      return <IcpDetail icp={(d.icp as Record<string, unknown>) ?? d} filters={d.discovery_filters as Record<string, unknown> | undefined} />;
    }
    case "request_clarification":
      return <p className="text-sm text-[var(--color-text)]">{String((data as Record<string, unknown>).question)}</p>;
    case "discover_companies":
      return Array.isArray(data) ? <LegacyCandidateListDetail candidates={data as Array<Record<string, unknown>>} /> : <DiscoveryDetail result={data as unknown as DiscoveryData} />;
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

function IcpDetail({ icp, filters }: { icp: Record<string, unknown>; filters?: Record<string, unknown> }) {
  const industries = Array.isArray(filters?.industries) ? (filters.industries as Array<{ id: string; label: string }>) : [];
  const min = filters?.headcount_min as number | null | undefined;
  const max = filters?.headcount_max as number | null | undefined;
  return (
    <div className="space-y-4">
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
      {filters && (
        <div className="grid grid-cols-1 gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-3">
          <ListField label="LinkedIn industries (search filter)" items={industries.map((i) => `${i.label} (${i.id})`)} />
          <Field label="Headcount (search filter)">{min == null && max == null ? "Any" : `${min ?? 1} - ${max ?? "no upper bound"}`}</Field>
          <ListField label="Locations (search filter)" items={filters.locations} />
        </div>
      )}
    </div>
  );
}

interface CriterionVerdict {
  status: "pass" | "fail" | "needs_review";
  reason: string;
}

interface DiscoveredCompany {
  name: string;
  domain: string | null;
  website: string | null;
  linkedinUrl: string | null;
  tagline: string | null;
  employeeCountRange: { start: number; end: number | null } | null;
  industries: Array<{ name: string }>;
  prefilter: { size: CriterionVerdict; location: CriterionVerdict; concerns: string[]; dropReason: string | null };
}

interface DiscoveryData {
  search: { keyword: string | null; industries: Array<{ id: string; label: string }>; locations: string[]; companySize: string[]; page: number };
  attempt: number;
  totalResultCount: number;
  itemCount: number;
  candidates: DiscoveredCompany[];
  dropped: DiscoveredCompany[];
  duplicateCount: number;
  cacheHit: boolean;
}

const VERDICT_STYLE: Record<CriterionVerdict["status"], string> = {
  pass: "text-[var(--color-success-text)]",
  needs_review: "text-[var(--color-warning-text)]",
  fail: "text-[var(--color-danger-text)]",
};

const VERDICT_LABEL: Record<CriterionVerdict["status"], string> = { pass: "Pass", needs_review: "Review", fail: "Fail" };

/** Links only to http(s) URLs - company-supplied values never become a javascript: link. */
function SafeLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  const url = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-[var(--color-accent)] underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

function CompanyRow({ c, dropped }: { c: DiscoveredCompany; dropped?: boolean }) {
  const size = c.employeeCountRange ? `${c.employeeCountRange.start}-${c.employeeCountRange.end ?? "+"}` : null;
  const reason = dropped ? c.prefilter.dropReason ?? [c.prefilter.size, c.prefilter.location].find((v) => v.status === "fail")?.reason : null;
  return (
    <li className="border-b border-[var(--color-border)] py-2 text-sm last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-[var(--color-text)]">{c.name}</span>
        <SafeLink href={c.website}>{c.domain ?? c.website}</SafeLink>
        <SafeLink href={c.linkedinUrl}>LinkedIn</SafeLink>
        {size && <span className="text-xs text-[var(--color-text-muted)]">{size} employees</span>}
        {c.industries[0] && <span className="text-xs text-[var(--color-text-muted)]">{c.industries[0].name}</span>}
      </div>
      {c.tagline && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{c.tagline}</p>}
      {dropped ? (
        <p className="mt-0.5 text-xs text-[var(--color-danger-text)]">Dropped: {reason}</p>
      ) : (
        <p className="mt-0.5 text-xs">
          <span className={VERDICT_STYLE[c.prefilter.size.status]}>Size: {VERDICT_LABEL[c.prefilter.size.status]}</span>
          <span className="text-[var(--color-text-muted)]"> · </span>
          <span className={VERDICT_STYLE[c.prefilter.location.status]}>Location: {VERDICT_LABEL[c.prefilter.location.status]}</span>
          {c.prefilter.location.status !== "pass" && <span className="text-[var(--color-text-muted)]"> - {c.prefilter.location.reason}</span>}
        </p>
      )}
    </li>
  );
}

function DiscoveryDetail({ result }: { result: DiscoveryData }) {
  const s = result.search;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Keyword">{s.keyword ? `"${s.keyword}"` : "None (filters only)"}</Field>
        <Field label="Industries">{s.industries.map((i) => i.label).join(", ")}</Field>
        <Field label="Page">{String(s.page)}</Field>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        LinkedIn pool: {result.totalResultCount} matching companies. Returned {result.itemCount}: {result.candidates.length} kept, {result.dropped.length} dropped by the size/location/website check, {result.duplicateCount} already seen earlier in this run
        {result.cacheHit ? " (served from cache, no spend)" : ""}.
      </p>
      {result.candidates.length > 0 && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Kept for qualification ({result.candidates.length})</div>
          <ul className="max-h-80 overflow-y-auto">{result.candidates.map((c, i) => <CompanyRow key={i} c={c} />)}</ul>
        </div>
      )}
      {result.dropped.length > 0 && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Dropped ({result.dropped.length})</div>
          <ul className="max-h-48 overflow-y-auto">{result.dropped.map((c, i) => <CompanyRow key={i} c={c} dropped />)}</ul>
        </div>
      )}
    </div>
  );
}

function LegacyCandidateListDetail({ candidates }: { candidates: Array<Record<string, unknown>> }) {
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
        {confidenceLabel(status, lead.confidence as number | undefined) && (
          <span className="text-xs text-[var(--color-text-muted)]">{confidenceLabel(status, lead.confidence as number | undefined)}</span>
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
        <Field label="Evidence the personalization is built on">{draft.personalization_note}</Field>
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
