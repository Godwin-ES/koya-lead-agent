"use client";

import { useState } from "react";
import Link from "next/link";
import { User, Settings } from "lucide-react";
import { ActionButton } from "@/components/primitives/action-button";
import { ThemeToggle } from "./theme-toggle";
import { signOut } from "@/app/(app)/actions";

export function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-2">
      <ThemeToggle />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      >
        <User className="h-4 w-4" aria-hidden="true" />
        <span className="max-w-[10rem] truncate">{email}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg"
        >
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
          <ActionButton
            action={() => signOut()}
            idleLabel="Sign out"
            pendingLabel="Signing out"
            variant="ghost"
            className="w-full justify-start gap-2"
          />
        </div>
      )}
    </div>
  );
}
