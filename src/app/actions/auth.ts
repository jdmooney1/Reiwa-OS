"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAuthSession } from "@/lib/auth/service";

export interface SignInState {
  error?: string;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "Enter your email and password." };

  // Supabase Auth verifies the credentials and writes the session cookies.
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Invalid email or password." };

  // A Supabase account without a Reiwa profile has no authorisation context.
  const session = await loadAuthSession(data.user.id);
  if (!session) {
    await supabase.auth.signOut();
    return { error: "This account is not provisioned for Reiwa OS." };
  }

  redirect("/portfolio");
}

export async function signOutAction(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
