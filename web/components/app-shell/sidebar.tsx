"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, Settings, FlaskConical, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/runs", label: "Runs", icon: ListChecks },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/test-console", label: "Test Console", icon: FlaskConical },
];

/**
 * Collapsed state is a per-viewer convenience (SYSTEM-DESIGN-NEXTJS.md
 * §17.6's browser-storage guidance: "a collapsed section" is exactly the
 * kind of thing localStorage is for, never state that must persist
 * reliably or be shared between viewers).
 */
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width]",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <div className="flex items-center justify-between px-3 py-4">
        {!collapsed && <span className="text-sm font-semibold text-[var(--color-text)]">Koya Lead Agent</span>}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                active
                  ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
