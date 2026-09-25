import { RunTabs } from "@/components/runs/run-tabs";

export default async function RunLayout(props: LayoutProps<"/runs/[id]">) {
  const { id } = await props.params;
  return (
    <div>
      <RunTabs runId={id} />
      {props.children}
    </div>
  );
}
