import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * The server-side client for Server Components, Server Actions, and Route
 * Handlers - still the anon key, still RLS-scoped, never `service_role`
 * (that lives only in the worker environment, SYSTEM-DESIGN-NEXTJS.md
 * §15). A new client per request, per @supabase/ssr's own guidance -
 * never shared across requests.
 *
 * `cookies()` is async in this Next.js version (confirmed against the
 * bundled docs before writing this, not assumed from training data).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot set cookies.
            // Harmless as long as the proxy (proxy.ts) refreshes the
            // session on every request - see that file's comment.
          }
        },
      },
    },
  );
}
