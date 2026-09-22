import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/primitives/status-badge";
import { CopyButton } from "./copy-button";
import { UntrustedContent } from "./untrusted-content";
import { LEAD_STATUS } from "@core/domain/status";
import type { LeadRow, OutreachDraftRow, ScrapeCacheRow } from "@core/db/row-types";

export interface EvidenceDrawerProps {
  runId: string;
  lead: LeadRow;
  drafts: OutreachDraftRow[];
  scrapedPages: ScrapeCacheRow[];
}

function DraftCard({ draft }: { draft: OutreachDraftRow }) {
  const grounding = draft.grounding_check as { flagged?: boolean } | null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {draft.channel === "email" ? `Email ${draft.step}` : "LinkedIn message"}
        </h3>
        {grounding?.flagged && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning-text)]">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            Unsupported claim flagged - review before use
          </span>
        )}
      </div>
      {draft.subject && <p className="mb-1 text-sm font-medium text-[var(--color-text)]">{draft.subject}</p>}
      <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{draft.body}</p>
      <p className="mt-2 text-xs italic text-[var(--color-text-muted)]">{draft.personalization_note}</p>
      <div className="mt-3">
        <CopyButton text={draft.subject ? `${draft.subject}\n\n${draft.body}` : draft.body} label="Copy draft" />
      </div>
    </div>
  );
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.1/§17.9: source URLs, source summary, fit
 * reasons, concerns, injection badge, the 3-step email sequence + the
 * LinkedIn message, grounding results. Rendered as a full route
 * (`/runs/[id]/leads/[leadId]`) rather than a client-side overlay: this
 * satisfies "deep-linkable, Back closes it, refresh lands on the same
 * drawer" exactly as well as a true intercepting-route modal would,
 * without the added parallel-route machinery a cohort project this size
 * doesn't need - a deliberate scope call, not an oversight.
 */
export function EvidenceDrawer({ runId, lead, drafts, scrapedPages }: EvidenceDrawerProps) {
  const emails = drafts.filter((d) => d.channel === "email").sort((a, b) => a.step - b.step);
  const linkedin = drafts.find((d) => d.channel === "linkedin");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/runs/${runId}/leads`} className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to leads
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-[var(--color-text)]">{lead.company_name}</h1>
          <StatusBadge entry={LEAD_STATUS[lead.qualification_status]} />
          {lead.injection_flagged && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-danger-text)]">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              Injection flagged
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          {lead.company_domain} - {Math.round(lead.confidence * 100)}% confidence
        </p>
      </div>

      {lead.qualification_status === "needs_review" && lead.evidence_gap_reason && (
        <p className="rounded-md bg-[var(--color-warning-bg)] px-3 py-2 text-sm text-[var(--color-warning-text)]">
          Needs review: {lead.evidence_gap_reason}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Source URLs</h2>
        <ul className="space-y-1">
          {lead.source_urls.map((url) => (
            <li key={url} className="flex items-center justify-between gap-2 text-sm">
              <a href={url} target="_blank" rel="noreferrer" className="truncate text-[var(--color-accent)] hover:underline">
                {url}
              </a>
              <CopyButton text={url} label="Copy" />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Source summary</h2>
        <p className="text-sm text-[var(--color-text)]">{lead.source_summary || "No summary recorded."}</p>
      </section>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Fit reasons</h2>
          {lead.fit_reasons.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">None recorded.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-sm text-[var(--color-text)]">
              {lead.fit_reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Concerns</h2>
          {lead.concerns.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">None recorded.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-sm text-[var(--color-text)]">
              {lead.concerns.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {scrapedPages.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Scraped page content</h2>
          <div className="space-y-3">
            {scrapedPages.map((page) => (
              <UntrustedContent key={page.id} url={page.url} text={page.content_md ?? "(no content captured)"} />
            ))}
          </div>
        </section>
      )}

      {drafts.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Outreach drafts</h2>
          <div className="space-y-3">
            {emails.map((draft) => (
              <DraftCard key={draft.id} draft={draft} />
            ))}
            {linkedin && <DraftCard draft={linkedin} />}
          </div>
        </section>
      )}
    </div>
  );
}
