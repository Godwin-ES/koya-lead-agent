"use client";

import { useState } from "react";
import { Check, Copy, Download, Printer } from "lucide-react";

export interface SamplePackActionsProps {
  markdown: string;
  /** Plain text for the clipboard - readable wherever it's pasted. */
  text: string;
}

/** Task 19 Step 3: copy-all, markdown download, print - a real feature, not a manual copy-paste job. */
export function SamplePackActions({ markdown, text }: SamplePackActionsProps) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Low-stakes convenience action - fail quietly.
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lead-sample-pack.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2 print:hidden">
      <button
        type="button"
        onClick={copyAll}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      >
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        {copied ? "Copied" : "Copy all"}
      </button>
      <button
        type="button"
        onClick={downloadMarkdown}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Download markdown
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      >
        <Printer className="h-4 w-4" aria-hidden="true" />
        Print / save as PDF
      </button>
    </div>
  );
}
