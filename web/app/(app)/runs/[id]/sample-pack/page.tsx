import { notFound } from "next/navigation";
import { getSamplePackMarkdown } from "@/actions/export";
import { EmptyState } from "@/components/primitives/empty-state";
import { SamplePackActions } from "@/components/quality/sample-pack-actions";

export default async function SamplePackPage(props: PageProps<"/runs/[id]/sample-pack">) {
  const { id } = await props.params;
  const result = await getSamplePackMarkdown(id);

  if (result.error) notFound();
  const markdown = result.markdown ?? "";
  const hasQualifiedLeads = markdown.includes("## ");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold text-[var(--color-text)] print:hidden">Sample pack</h1>

      {!hasQualifiedLeads ? (
        <EmptyState
          title="No qualified leads yet"
          description="The sample pack is generated from qualified leads - it will appear here once at least one lead qualifies."
        />
      ) : (
        <>
          <SamplePackActions markdown={markdown} />
          <article className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">{markdown}</article>
        </>
      )}
    </div>
  );
}
