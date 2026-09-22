import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscoveryCacheRow, ScrapeCacheRow } from "./row-types";

/**
 * `discovery_cache` / `scrape_cache` - worker-only (service_role) per
 * Task 4's RLS: these tables have no policies for `anon`/`authenticated`
 * at all. This is what makes a repeated objective or a repeated URL cost
 * $0 (§11), and it's the layer that makes the "repeat run" test scenario
 * provable from tool_calls' `cache_hit` status rows.
 */

export async function getDiscoveryCache(supabase: SupabaseClient, cacheKey: string): Promise<DiscoveryCacheRow | null> {
  const { data, error } = await supabase
    .from("discovery_cache")
    .select()
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data as DiscoveryCacheRow | null;
}

export async function setDiscoveryCache(
  supabase: SupabaseClient,
  values: Omit<DiscoveryCacheRow, "id" | "created_at">,
): Promise<DiscoveryCacheRow> {
  const { data, error } = await supabase
    .from("discovery_cache")
    .upsert(values, { onConflict: "cache_key" })
    .select()
    .single();
  if (error) throw error;
  return data as DiscoveryCacheRow;
}

/**
 * Fetches whatever scraped content the user's own RLS grants them
 * visibility into for a set of URLs - the evidence drawer's source
 * material (SYSTEM-DESIGN-NEXTJS.md §17.9). Scoped by `scrape_cache`'s
 * own RLS policy (migration 012), not by anything this function does
 * itself: a caller with the anon/authenticated client only ever gets
 * back rows for URLs that are also in `source_urls` on a lead they own.
 */
export async function listScrapeCacheForUrls(supabase: SupabaseClient, urls: string[]): Promise<ScrapeCacheRow[]> {
  if (urls.length === 0) return [];
  const { data, error } = await supabase.from("scrape_cache").select().in("url", urls);
  if (error) throw error;
  return (data ?? []) as ScrapeCacheRow[];
}

export async function getScrapeCache(supabase: SupabaseClient, urlHash: string): Promise<ScrapeCacheRow | null> {
  const { data, error } = await supabase
    .from("scrape_cache")
    .select()
    .eq("url_hash", urlHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data as ScrapeCacheRow | null;
}

export async function setScrapeCache(
  supabase: SupabaseClient,
  values: Omit<ScrapeCacheRow, "id" | "fetched_at">,
): Promise<ScrapeCacheRow> {
  const { data, error } = await supabase
    .from("scrape_cache")
    .upsert(values, { onConflict: "url_hash" })
    .select()
    .single();
  if (error) throw error;
  return data as ScrapeCacheRow;
}
