import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLeadById } from "@core/db/leads";
import { listScrapeCacheForUrls } from "@core/db/cache";
import { LeadDetail, LEAD_TABS, type LeadTab } from "@/components/review/lead-detail";

export default async function LeadPage(props: PageProps<"/runs/[id]/leads/[leadId]">) {
  const { id, leadId } = await props.params;
  const requestedTab = (await props.searchParams).tab;
  const supabase = await createClient();

  const lead = await getLeadById(supabase, leadId);
  if (!lead || lead.run_id !== id) notFound();

  const scrapedPages = await listScrapeCacheForUrls(supabase, lead.source_urls);
  const tab: LeadTab = LEAD_TABS.find((t) => t === requestedTab) ?? "decision";

  return <LeadDetail runId={id} lead={lead} scrapedPages={scrapedPages} tab={tab} />;
}
