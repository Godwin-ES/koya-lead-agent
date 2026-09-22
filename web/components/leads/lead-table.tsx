"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { EmptyState } from "@/components/primitives/empty-state";
import { LEAD_STATUS } from "@core/domain/status";
import type { LeadRow } from "@core/db/row-types";
import type { LeadQualificationStatus } from "@core/domain/types";

export interface LeadTableProps {
  runId: string;
  leads: LeadRow[];
}

type SortKey = "company_name" | "company_domain" | "qualification_status" | "confidence";
type SortDirection = "asc" | "desc";

const FILTER_OPTIONS: LeadQualificationStatus[] = ["qualified", "not_qualified", "needs_review"];

interface SortHeaderProps {
  label: string;
  sortKeyName: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onToggle: (key: SortKey) => void;
}

/** Hoisted out of LeadTable's render body - a component declared inline is recreated (and loses its identity) on every render. */
function SortHeader({ label, sortKeyName, activeKey, direction, onToggle }: SortHeaderProps) {
  const isActive = activeKey === sortKeyName;
  const Icon = !isActive ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="py-2 font-medium" aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onToggle(sortKeyName)} className="inline-flex items-center gap-1 hover:text-[var(--color-text)]">
        {label}
        <Icon className="h-3 w-3" aria-hidden="true" />
      </button>
    </th>
  );
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.9: sticky header, sortable columns, filter
 * chips with a clear-all, result count, virtualization past ~100 rows.
 * Virtualization is deliberately not implemented: `candidate_limit`'s
 * own range (packages/core/src/domain/limits.ts, max 40) makes more
 * than ~40 leads on a single run structurally impossible in this
 * app - a virtualized list for a threshold this product can never
 * reach would be dead code, not a real feature.
 */
export function LeadTable({ runId, leads }: LeadTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("confidence");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [activeFilters, setActiveFilters] = useState<Set<LeadQualificationStatus>>(new Set());

  function toggleFilter(status: LeadQualificationStatus) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  const visible = useMemo(() => {
    const filtered = activeFilters.size === 0 ? leads : leads.filter((l) => activeFilters.has(l.qualification_status));
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [leads, activeFilters, sortKey, sortDirection]);

  // needs_review leads are never counted toward "qualified" anywhere in
  // this app - the same rule run_summary()'s own SQL enforces
  // server-side (Task 12/5: WHERE qualification_status = 'qualified',
  // never a truthy check that could accidentally include needs_review).
  const qualifiedCount = leads.filter((l) => l.qualification_status === "qualified").length;

  if (leads.length === 0) {
    return (
      <EmptyState
        title="No leads yet"
        description="Leads will appear here once the agent starts qualifying candidates."
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((status) => {
          const active = activeFilters.has(status);
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleFilter(status)}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              {LEAD_STATUS[status].label}
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button
            type="button"
            onClick={() => setActiveFilters(new Set())}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] underline hover:text-[var(--color-text)]"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Clear all
          </button>
        )}
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          {visible.length} of {leads.length} leads - {qualifiedCount} qualified
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[var(--color-surface)]">
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <SortHeader label="Company" sortKeyName="company_name" activeKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
              <SortHeader label="Domain" sortKeyName="company_domain" activeKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
              <SortHeader label="Status" sortKeyName="qualification_status" activeKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
              <SortHeader label="Confidence" sortKeyName="confidence" activeKey={sortKey} direction={sortDirection} onToggle={toggleSort} />
              <th className="py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((lead) => (
              <tr key={lead.id} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-2)]">
                <td className="py-2 pl-3">
                  <Link href={`/runs/${runId}/leads/${lead.id}`} className="font-medium text-[var(--color-text)] hover:underline">
                    {lead.company_name}
                  </Link>
                </td>
                <td className="py-2 text-[var(--color-text-muted)]">{lead.company_domain}</td>
                <td className="py-2">
                  <StatusBadge entry={LEAD_STATUS[lead.qualification_status]} />
                </td>
                <td className="py-2 text-[var(--color-text-muted)]">{Math.round(lead.confidence * 100)}%</td>
                <td className="py-2">
                  {lead.injection_flagged && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-danger-text)]"
                      title="This page's content included a prompt-injection attempt, which was flagged and ignored."
                    >
                      <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                      Injection flagged
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
