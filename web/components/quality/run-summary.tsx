import { layoutSummary } from "@core/domain/summary-layout";

/** The agent's finalize summary, with its paragraphs and lists kept. */
export function RunSummary({ summary }: { summary: string }) {
  const blocks = layoutSummary(summary);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[var(--color-text)]">
      {blocks.map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i}>{block.text}</p>
        ) : block.kind === "bullets" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
