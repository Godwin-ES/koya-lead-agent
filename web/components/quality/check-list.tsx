import { CheckCircle2, XCircle } from "lucide-react";
import type { QualityCheckResult, QualityScorecardEntry } from "@core/schemas/quality";

function Row({ passed, title, detail }: { passed: boolean; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-2 border-b border-[var(--color-border)] py-2 last:border-b-0">
      {passed ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success-text)]" aria-hidden="true" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger-text)]" aria-hidden="true" />
      )}
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{detail}</p>
      </div>
    </li>
  );
}

const CHECK_LABELS: Record<string, string> = {
  has_ten_qualified: "Target qualified lead count reached",
  every_lead_has_name_and_domain: "Every lead has a name and domain",
  every_lead_has_qualification_reasoning: "Every lead has qualification reasoning",
  every_lead_has_source_context: "Every lead has source context",
  every_qualified_lead_has_outreach_drafts: "Every qualified lead has outreach drafts",
  no_email_finding_or_validation_attempted: "No email finding or validation attempted",
  no_duplicate_companies: "No duplicate companies",
  needs_review_excluded_from_qualified_count: "needs_review excluded from qualified count",
};

const SCORECARD_LABELS: Record<string, string> = {
  icp_fit: "ICP fit",
  evidence_quality: "Evidence quality",
  duplicate_rate: "Duplicate rate",
  outreach_relevance: "Outreach relevance",
  data_completeness: "Data completeness",
  safety_compliance: "Safety compliance",
};

export function CheckList({ checks }: { checks: QualityCheckResult[] }) {
  return (
    <ul>
      {checks.map((c) => (
        <Row key={c.id} passed={c.passed} title={CHECK_LABELS[c.id] ?? c.id} detail={c.detail} />
      ))}
    </ul>
  );
}

export function Scorecard({ scorecard }: { scorecard: QualityScorecardEntry[] }) {
  return (
    <ul>
      {scorecard.map((s) => (
        <Row key={s.dimension} passed={s.passed} title={SCORECARD_LABELS[s.dimension] ?? s.dimension} detail={s.note} />
      ))}
    </ul>
  );
}
