import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DisplayNameForm } from "@/components/settings/display-name-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const displayName = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : "";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-lg font-semibold text-[var(--color-text)]">Settings</h1>
      <section className="rounded-lg border border-[var(--color-border)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Display name</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Outreach drafts are signed with this name, followed by Koya Talent. Drafts saved before you change it keep the name they were signed
          with.
        </p>
        <DisplayNameForm initialName={displayName} email={user.email ?? ""} />
      </section>
    </div>
  );
}
