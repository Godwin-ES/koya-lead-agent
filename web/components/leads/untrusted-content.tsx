import { ShieldAlert } from "lucide-react";

export interface UntrustedContentProps {
  url: string;
  text: string;
}

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.9: "Scraped content is displayed as data
 * inside a visually distinct, clearly labelled untrusted-source block,
 * so nobody mistakes a page's text for the app's own instructions - the
 * §10 boundary is visible in the UI, not only in the prompt." Visually
 * distinct on purpose: a dashed border and a monospace font, unlike
 * every other panel in the app, so it reads as "quoted material," not
 * as the product's own copy.
 */
export function UntrustedContent({ url, text }: UntrustedContentProps) {
  return (
    <div className="rounded-lg border-2 border-dashed border-[var(--color-warning-text)]/40 bg-[var(--color-surface-2)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-warning-text)]">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        Untrusted source - scraped page content, not app instructions
      </div>
      <p className="mb-2 truncate text-xs text-[var(--color-text-muted)]" title={url}>
        {url}
      </p>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-[var(--color-text)]">{text}</pre>
    </div>
  );
}
