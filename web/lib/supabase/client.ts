import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser client, using the anon key. RLS (Task 4) is what actually
 * scopes what this client can see - never trust the browser alone
 * (SYSTEM-DESIGN-NEXTJS.md §15: "No secrets in the browser... The
 * Next.js app uses the anon key with RLS").
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
