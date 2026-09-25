import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The display name a user set in Settings (auth user_metadata.display_name),
 * used to sign their outreach drafts. Needs a service-role client (the
 * worker's) - it reads another user's record through the admin API.
 * Returns null when it isn't set or can't be read, and drafts then sign
 * off as the company rather than using a placeholder.
 */
export async function getSenderName(supabase: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) return null;
    const name = data.user?.user_metadata?.display_name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}
