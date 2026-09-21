import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscoveryCacheRow, ScrapeCacheRow } from "./row-types.js";

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
