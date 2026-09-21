"use client";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useLocalStorageBoolean } from "@/lib/use-local-storage-boolean";

const COLLAPSE_KEY = "koya:sidebar-collapsed";

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorageBoolean(COLLAPSE_KEY, false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={email} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
