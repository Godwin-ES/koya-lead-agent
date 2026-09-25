"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface AccountActionResult {
  error?: string;
}

const MAX_DISPLAY_NAME_LENGTH = 80;

/** The name outreach drafts are signed with (auth user_metadata.display_name). */
export async function updateDisplayName(displayName: string): Promise<AccountActionResult> {
  const name = displayName.trim().replace(/\s+/g, " ");
  if (!name) return { error: "Enter the name your outreach should be signed with." };
  if (name.length > MAX_DISPLAY_NAME_LENGTH) return { error: `Keep it under ${MAX_DISPLAY_NAME_LENGTH} characters.` };
  if (/[[\]{}<>]/.test(name)) return { error: "Use your real name - no brackets or placeholders." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return {};
}
