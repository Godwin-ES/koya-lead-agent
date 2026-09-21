"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { UserMenu } from "./user-menu";

function titleCase(segment: string) {
  return segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A plain path-segment breadcrumb - good enough until routes need custom labels (e.g. a run's objective). */
function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-[var(--color-text-muted)]">
      <Link href="/runs" className="hover:text-[var(--color-text)]">
        Koya Lead Agent
      </Link>
      {segments.map((segment, i) => {
        const href = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={href} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            {isLast ? (
              <span className="text-[var(--color-text)]" aria-current="page">
                {titleCase(segment)}
              </span>
            ) : (
              <Link href={href} className="hover:text-[var(--color-text)]">
                {titleCase(segment)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function Topbar({ email }: { email: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      <Breadcrumb />
      <UserMenu email={email} />
    </header>
  );
}
