"use server";

import { createClient } from "@/lib/supabase/server";
import { validateObjective, type ValidationResult } from "@core/validation/objective";

/**
 * The one server action that runs before a run exists at all
 * (SYSTEM-DESIGN-NEXTJS.md §7.1). Uses the caller's own session (anon
 * key + RLS), never service_role - this is a per-user write to
 * objective_validations, not worker territory.
 */
export async function checkObjective(objectiveText: string): Promise<ValidationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not signed in.");
  }

  return validateObjective(supabase, objectiveText, user.id);
}
