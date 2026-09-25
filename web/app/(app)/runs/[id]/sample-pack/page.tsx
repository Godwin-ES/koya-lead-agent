import { notFound } from "next/navigation";
import { getSamplePack } from "@/actions/export";
import { EmptyState } from "@/components/primitives/empty-state";
import { SamplePackActions } from "@/components/quality/sample-pack-actions";
import { SamplePackDocument } from "@/components/quality/sample-pack-document";

export default async function SamplePackPage(props: PageProps<"/runs/[id]/sample-pack">) {
  const { id } = await props.params;
  const result = await getSamplePack(id);
  if (result.error || !result.pack) notFound();

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      {result.pack.leads.length === 0 ? (
        <>
          <h1 className="mb-4 text-lg font-semibold text-[var(--color-text)]">Sample pack</h1>
          <EmptyState
            title="No qualified leads yet"
            description="The sample pack is generated from qualified leads - it will appear here once at least one lead qualifies."
          />
        </>
      ) : (
        <>
          <SamplePackActions markdown={result.markdown ?? ""} text={result.text ?? ""} />
          <SamplePackDocument pack={result.pack} />
        </>
      )}
    </div>
  );
}
