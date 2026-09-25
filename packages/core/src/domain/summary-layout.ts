/**
 * Lays out the run summary the agent writes at finalize_run: paragraphs,
 * bulleted lists and numbered lists. Older summaries were one run-on
 * paragraph ("Final results - 6 qualified leads ...: 1. AdeptForms - ...
 * 2. IgniteTech - ..."), so a summary with no line breaks gets its inline
 * numbered list split out first.
 */
export type SummaryBlock = { kind: "paragraph"; text: string } | { kind: "bullets"; items: string[] } | { kind: "numbered"; items: string[] };

const BULLET = /^\s*[-•*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** "... 1. A - x. 2. B - y. More text" -> lines, when the numbers run 1, 2, 3... */
function splitInlineNumberedList(text: string): string {
  const starts: number[] = [];
  let next = 1;
  const pattern = /(^|\s)(\d+)\.\s+(?=\S)/g;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (Number(m[2]) !== next) continue;
    starts.push(m.index + m[1].length);
    next += 1;
  }
  if (starts.length < 2) return text;

  const lines = [text.slice(0, starts[0]).trim()];
  starts.forEach((start, i) => {
    const item = text.slice(start, starts[i + 1] ?? text.length).trim();
    if (i < starts.length - 1) {
      lines.push(item);
      return;
    }
    // The last item runs on into the rest of the summary: end it at its first sentence.
    const numberLength = item.match(NUMBERED)?.[0].length ?? 0;
    const end = item.slice(numberLength).search(/\.\s+(?=[A-Z0-9])/);
    if (end === -1) lines.push(item);
    else lines.push(item.slice(0, numberLength + end + 1), "", item.slice(numberLength + end + 1).trim());
  });
  return lines.filter((l, i) => l !== "" || i > 0).join("\n");
}

export function layoutSummary(summary: string): SummaryBlock[] {
  const text = summary.includes("\n") ? summary : splitInlineNumberedList(summary);
  const blocks: SummaryBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const pushItem = (kind: "bullets" | "numbered", item: string) => {
    flushParagraph();
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.items.push(item);
    else blocks.push({ kind, items: [item] });
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      blocks.push({ kind: "paragraph", text: "" });
      continue;
    }
    if (BULLET.test(line)) pushItem("bullets", line.replace(BULLET, ""));
    else if (NUMBERED.test(line)) pushItem("numbered", line.replace(NUMBERED, ""));
    else paragraph.push(line);
  }
  flushParagraph();
  return blocks.filter((b) => b.kind !== "paragraph" || b.text !== "");
}
