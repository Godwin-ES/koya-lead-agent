"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface SignInResult {
  error: string | null;
}

export async function signIn(email: string, password: string, next: string): Promise<SignInResult> {
  if (!email.trim() || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

  if (error) {
    return { error: "Could not sign in. Check your email and password and try again." };
  }

  redirect(next.startsWith("/") ? next : "/runs");
}
