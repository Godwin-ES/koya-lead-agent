import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SamplePack, SamplePackLead } from "@core/quality/sample-pack";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Only http(s) links - source URLs come from scraped data. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] print:text-neutral-500">{children}</h3>;
}

function FlaggedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning-text)] print:border print:border-neutral-400 print:bg-transparent print:text-neutral-700">
      <ShieldAlert className="h-3 w-3" aria-hidden="true" />
      Check before sending: a claim couldn&apos;t be traced to the sources
    </span>
  );
}

function Message({ label, subject, body, flagged, approved }: { label: string; subject?: string; body: string; flagged: boolean; approved: boolean }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] print:border-neutral-300">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2 print:border-neutral-300">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] print:text-neutral-500">{label}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {flagged && <FlaggedBadge />}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium print:border print:border-neutral-400 print:bg-transparent print:text-neutral-700",
              approved ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]" : "border border-[var(--color-border)] text-[var(--color-text-muted)]",
            )}
          >
            {approved ? "Approved" : "Not yet approved"}
          </span>
        </span>
      </div>
      {subject !== undefined && (
        <p className="border-b border-[var(--color-border)] px-4 py-2 text-sm print:border-neutral-300">
          <span className="text-[var(--color-text-muted)] print:text-neutral-500">Subject: </span>
          <span className="font-medium text-[var(--color-text)] print:text-black">{subject}</span>
        </p>
      )}
      <p className="whitespace-pre-line px-4 py-3 text-sm leading-relaxed text-[var(--color-text)] print:text-black">{body}</p>
    </div>
  );
}

function LeadSection({ lead, index }: { lead: SamplePackLead; index: number }) {
  const outreachMissing = lead.emails.length < 3 || !lead.linkedin;
  return (
    <section
      aria-labelledby={`lead-${lead.id}`}
      className={cn("space-y-5 border-t border-[var(--color-border)] pt-8 print:border-neutral-300", index > 0 && "print:break-before-page print:border-t-0 print:pt-0")}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id={`lead-${lead.id}`} className="text-xl font-semibold text-[var(--color-text)] print:text-black">
            {lead.companyName}
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] print:text-neutral-600">{lead.companyDomain}</p>
          {lead.reviewerReason && <p className="mt-1 text-sm text-[var(--color-text)] print:text-black">Qualified by reviewer: {lead.reviewerReason}</p>}
        </div>
        <span className="rounded-full bg-[var(--color-success-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-success-text)] print:border print:border-neutral-400 print:bg-transparent print:text-neutral-700">
          Qualified - {Math.round(lead.confidence * 100)}% confidence
        </span>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <SectionLabel>Why it qualifies</SectionLabel>
          <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-[var(--color-text)] print:text-black">
            {lead.fitReasons.length ? lead.fitReasons.map((r) => <li key={r}>{r}</li>) : <li>None recorded.</li>}
          </ul>
        </div>
        <div className="space-y-4">
          <div>
            <SectionLabel>Summary</SectionLabel>
            <p className="text-sm leading-relaxed text-[var(--color-text)] print:text-black">{lead.sourceSummary || "No summary recorded."}</p>
          </div>
          {lead.concerns.length > 0 && (
            <div>
              <SectionLabel>Concerns</SectionLabel>
              <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-[var(--color-text)] print:text-black">
                {lead.concerns.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <SectionLabel>Sources</SectionLabel>
            <ul className="space-y-0.5 text-sm">
              {lead.sourceUrls.map((url) => {
                const href = safeHref(url);
                return (
                  <li key={url} className="truncate">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--color-accent)] hover:underline print:text-black print:no-underline">
                        {url}
                      </a>
                    ) : (
                      <span className="text-[var(--color-text)]">{url}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <SectionLabel>Outreach drafts</SectionLabel>
        {outreachMissing && (
          <p className="text-sm text-[var(--color-warning-text)] print:text-neutral-700">
            Incomplete: {3 - lead.emails.length > 0 ? `${3 - lead.emails.length} email step${3 - lead.emails.length === 1 ? "" : "s"}` : ""}
            {3 - lead.emails.length > 0 && !lead.linkedin ? " and " : ""}
            {!lead.linkedin ? "the LinkedIn message" : ""} missing.
          </p>
        )}
        {lead.emails.map((email) => (
          <Message key={email.step} label={`Email ${email.step} of 3`} subject={email.subject} body={email.body} flagged={email.flagged} approved={email.approved} />
        ))}
        {lead.linkedin && <Message label="LinkedIn message" body={lead.linkedin.body} flagged={lead.linkedin.flagged} approved={lead.linkedin.approved} />}
      </div>
    </section>
  );
}

/** The sample pack as a document: the same page on screen and in print (the app shell hides itself in print). */
export function SamplePackDocument({ pack }: { pack: SamplePack }) {
  return (
    <article className="space-y-8 print:space-y-6">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)] print:text-neutral-500">Koya Talent - lead research</p>
        <h1 className="text-2xl font-semibold text-[var(--color-text)] print:text-black">Lead sample pack</h1>
        <dl className="grid grid-cols-1 gap-3 rounded-lg bg-[var(--color-surface-2)] p-4 text-sm sm:grid-cols-[1fr_auto_auto] print:border print:border-neutral-300 print:bg-transparent">
          <div>
            <dt className="text-xs font-medium text-[var(--color-text-muted)] print:text-neutral-500">Objective</dt>
            <dd className="mt-0.5 text-[var(--color-text)] print:text-black">{pack.objective}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[var(--color-text-muted)] print:text-neutral-500">Qualified leads</dt>
            <dd className="mt-0.5 font-semibold text-[var(--color-text)] print:text-black">{pack.leads.length}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[var(--color-text-muted)] print:text-neutral-500">Generated</dt>
            <dd className="mt-0.5 text-[var(--color-text)] print:text-black">{formatDate(pack.generatedAt)}</dd>
          </div>
        </dl>
        <p className="text-xs text-[var(--color-text-muted)] print:text-neutral-600">Drafts for human review - nothing here has been sent.</p>
      </header>

      {pack.leads.map((lead, i) => (
        <LeadSection key={lead.id} lead={lead} index={i} />
      ))}
    </article>
  );
}
