"use client";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useLocalStorageBoolean } from "@/lib/use-local-storage-boolean";

const COLLAPSE_KEY = "koya:sidebar-collapsed";

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useLocalStorageBoolean(COLLAPSE_KEY, false);

  return (
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      <div className="print:hidden">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <div className="print:hidden">
          <Topbar email={email} />
        </div>
        {/* Task 19 Step 3: a print stylesheet producing a clean PDF for
            the sample pack - the app shell (sidebar, topbar) is hidden
            and the content column becomes unconstrained, via the
            print:* utilities above and on this element. */}
        <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
