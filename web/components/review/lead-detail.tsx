import Link from "next/link";
import { ArrowLeft, ExternalLink, ShieldAlert, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { UntrustedContent } from "@/components/leads/untrusted-content";
import { LEAD_STATUS } from "@core/domain/status";
import type { LeadRow, ScrapeCacheRow } from "@core/db/row-types";
import { ReviewActions } from "./review-actions";
import { confidenceLabel } from "@core/schemas/qualification";

export type LeadTab = "decision" | "evidence";
export const LEAD_TABS: readonly LeadTab[] = ["decision", "evidence"];

export interface LeadDetailProps {
  runId: string;
  lead: LeadRow;
  scrapedPages: ScrapeCacheRow[];
  tab: LeadTab;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-[var(--color-text)]">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function DecisionTab({ runId, lead }: { runId: string; lead: LeadRow }) {
  const byReviewer = lead.decided_by === "reviewer";
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge entry={LEAD_STATUS[lead.qualification_status]} />
          {confidenceLabel(lead.qualification_status, lead.confidence) && (
            <span className="text-sm text-[var(--color-text-muted)]">{confidenceLabel(lead.qualification_status, lead.confidence)}</span>
          )}
        </div>
        {byReviewer ? (
          <div className="mt-3 space-y-1 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-[var(--color-text)]">
              <UserCheck className="h-4 w-4" aria-hidden="true" />
              Your decision: {lead.review_reason}
            </p>
            {lead.agent_qualification_status && lead.agent_qualification_status !== lead.qualification_status && (
              <p className="text-[var(--color-text-muted)]">The agent had marked it {LEAD_STATUS[lead.agent_qualification_status].label.toLowerCase()}.</p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">Decided by the agent.</p>
        )}
        {lead.qualification_status === "needs_review" && lead.evidence_gap_reason && (
          <p className="mt-3 rounded-md bg-[var(--color-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-text)]">What&apos;s unclear: {lead.evidence_gap_reason}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Section title="Why it fits">
          <Bullets items={lead.fit_reasons} empty="No fit reasons recorded." />
        </Section>
        <Section title="Concerns">
          <Bullets items={lead.concerns} empty="None recorded." />
        </Section>
      </div>

      {lead.qualification_status === "qualified" && (
        <Section title="Outreach">
          <Link href={`/runs/${runId}/outreach?lead=${lead.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-accent)] hover:underline">
            Review this lead&apos;s emails and LinkedIn message in Outreach
          </Link>
        </Section>
      )}

      <Section title="Your review">
        <ReviewActions leadId={lead.id} status={lead.qualification_status} hasSources={lead.source_urls.length > 0} />
      </Section>
    </div>
  );
}

function EvidenceTab({ lead, scrapedPages }: { lead: LeadRow; scrapedPages: ScrapeCacheRow[] }) {
  const profile = (lead.discovery_payload ?? {}) as {
    tagline?: string | null;
    description?: string | null;
    industries?: Array<{ name: string }>;
    employeeCountRange?: { start: number; end: number | null } | null;
    locations?: Array<{ text: string | null; headquarter: boolean }>;
    foundedYear?: number | null;
    linkedinUrl?: string | null;
    website?: string | null;
  };
  const hq = profile.locations?.find((l) => l.headquarter)?.text;
  const size = profile.employeeCountRange ? `${profile.employeeCountRange.start}-${profile.employeeCountRange.end ?? "+"} employees` : null;
  const facts = [
    profile.industries?.length ? profile.industries.map((i) => i.name).join(", ") : null,
    size,
    hq ? `HQ: ${hq}` : null,
    profile.foundedYear ? `Founded ${profile.foundedYear}` : null,
  ].filter(Boolean);
  const linkedin = safeHref(profile.linkedinUrl);

  return (
    <div className="space-y-6">
      <Section title="Summary">
        <p className="text-sm leading-relaxed text-[var(--color-text)]">{lead.source_summary || "No summary recorded."}</p>
      </Section>

      <Section title="Sources">
        <ul className="space-y-1 text-sm">
          {lead.source_urls.map((url) => {
            const href = safeHref(url);
            return (
              <li key={url} className="truncate">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline">
                    {url}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ) : (
                  url
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {(profile.tagline || profile.description || facts.length > 0) && (
        <Section title="LinkedIn profile">
          <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-4 text-sm">
            {profile.tagline && <p className="font-medium text-[var(--color-text)]">{profile.tagline}</p>}
            {facts.length > 0 && <p className="text-[var(--color-text-muted)]">{facts.join(" · ")}</p>}
            {profile.description && <p className="whitespace-pre-line leading-relaxed text-[var(--color-text)]">{profile.description}</p>}
            {linkedin && (
              <a href={linkedin} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline">
                View on LinkedIn
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </Section>
      )}

      <Section title={`Scraped pages (${scrapedPages.length})`}>
        {scrapedPages.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No pages were scraped for this company.</p>
        ) : (
          <div className="space-y-2">
            {scrapedPages.map((page) => (
              <details key={page.id} className="rounded-lg border border-[var(--color-border)]">
                <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-[var(--color-text)]">{page.url}</summary>
                <div className="border-t border-[var(--color-border)] p-3">
                  <UntrustedContent url={page.url} text={page.content_md ?? "(no content captured)"} />
                </div>
              </details>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** One lead: the decision and your review, and the evidence it rests on - each on its own tab. Its outreach is reviewed in the run's Outreach tab. */
export function LeadDetail({ runId, lead, scrapedPages, tab }: LeadDetailProps) {
  const base = `/runs/${runId}/leads/${lead.id}`;
  const tabs: Array<{ key: LeadTab; label: string }> = [
    { key: "decision", label: "Decision" },
    { key: "evidence", label: "Evidence" },
  ];
  const website = safeHref(lead.company_domain);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={`/runs/${runId}/leads?status=${lead.qualification_status}`} className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to leads
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--color-text)]">{lead.company_name}</h1>
          <StatusBadge entry={LEAD_STATUS[lead.qualification_status]} />
          {lead.injection_flagged && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-danger-text)]">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              Injection flagged
            </span>
          )}
        </div>
        {website && (
          <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline">
            {lead.company_domain}
          </a>
        )}
      </header>

      <nav aria-label="Lead sections" className="border-b border-[var(--color-border)]">
        <ul className="flex gap-1">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link
                href={`${base}?tab=${t.key}`}
                aria-current={t.key === tab ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                  t.key === tab ? "border-[var(--color-accent)] text-[var(--color-text)]" : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "decision" && <DecisionTab runId={runId} lead={lead} />}
      {tab === "evidence" && <EvidenceTab lead={lead} scrapedPages={scrapedPages} />}
    </div>
  );
}
