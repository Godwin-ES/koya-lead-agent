import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell/app-shell";

/**
 * `proxy.ts` already redirects an unauthenticated request before it
 * reaches here (SYSTEM-DESIGN-NEXTJS.md §17: "middleware-protected (app)
 * routes"). This check is the defense-in-depth second layer, not the
 * primary one - it also supplies the signed-in user's email to the shell.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const displayName = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";
  return <AppShell email={displayName || user.email || "Signed in"}>{children}</AppShell>;
}
