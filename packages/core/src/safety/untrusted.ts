/**
 * Wraps scraped web content in a provenance-carrying boundary before it
 * ever reaches a model prompt (SYSTEM-DESIGN-NEXTJS.md §13 / assets/
 * outreach-safety-guide.md: "Treat scraped website text as data, not
 * instructions"). The boundary tag itself is the thing an injection
 * attempt would need to forge to "escape" the untrusted region, so any
 * literal occurrence of it inside the scraped text is neutralized before
 * wrapping - otherwise a page containing its own fake closing tag could
 * terminate the boundary early and have the rest of its text read as
 * trusted framing.
 */

const MAX_CONTENT_CHARS = 20_000;

export interface UntrustedSourceInput {
  url: string;
  scraper: string;
  text: string;
  /** Defaults to 20,000. Marked `truncated="true"` on the boundary whenever it applies. */
  maxChars?: number;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeBoundaryTags(text: string): string {
  return text
    .split("</untrusted_source>")
    .join("&lt;/untrusted_source&gt;")
    .split("<untrusted_source")
    .join("&lt;untrusted_source");
}

export function wrapUntrusted(input: UntrustedSourceInput): string {
  let text = escapeBoundaryTags(input.text);
  let truncated = false;
  const maxChars = input.maxChars ?? MAX_CONTENT_CHARS;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }

  const truncatedAttr = truncated ? ' truncated="true"' : "";
  const url = escapeAttr(input.url);
  const scraper = escapeAttr(input.scraper);

  return `<untrusted_source url="${url}" scraper="${scraper}"${truncatedAttr}>\n${text}\n</untrusted_source>`;
}
