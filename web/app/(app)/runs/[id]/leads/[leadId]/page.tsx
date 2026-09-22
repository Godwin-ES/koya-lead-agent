import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLeadById } from "@core/db/leads";
import { listDraftsForLead } from "@core/db/drafts";
import { listScrapeCacheForUrls } from "@core/db/cache";
import { EvidenceDrawer } from "@/components/leads/evidence-drawer";

export default async function LeadEvidencePage(props: PageProps<"/runs/[id]/leads/[leadId]">) {
  const { id, leadId } = await props.params;
  const supabase = await createClient();

  const lead = await getLeadById(supabase, leadId);
  if (!lead || lead.run_id !== id) notFound();

  const [drafts, scrapedPages] = await Promise.all([
    listDraftsForLead(supabase, leadId),
    listScrapeCacheForUrls(supabase, lead.source_urls),
  ]);

  return <EvidenceDrawer runId={id} lead={lead} drafts={drafts} scrapedPages={scrapedPages} />;
}
