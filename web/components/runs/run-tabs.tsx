"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface RunTabsProps {
  runId: string;
}

/** The run's sections, each its own page: progress, the leads and their decisions, outreach review, the quality report, and the export. */
export function RunTabs({ runId }: RunTabsProps) {
  const pathname = usePathname();
  const base = `/runs/${runId}`;
  const tabs: Array<{ href: string; label: string; exact?: boolean }> = [
    { href: base, label: "Progress", exact: true },
    { href: `${base}/leads`, label: "Leads" },
    { href: `${base}/outreach`, label: "Outreach" },
    { href: `${base}/quality`, label: "Quality" },
    { href: `${base}/sample-pack`, label: "Sample pack" },
  ];

  return (
    <nav aria-label="Run sections" className="mb-6 overflow-x-auto border-b border-[var(--color-border)] print:hidden">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                  active
                    ? "border-[var(--color-accent)] text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:text-[var(--color-text)]",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
