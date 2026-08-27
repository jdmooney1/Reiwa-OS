"use server";

import { redirect } from "next/navigation";
import { authenticate } from "@/lib/auth/service";
import { createSessionCookie, clearSessionCookie } from "@/lib/auth/session";

export interface SignInState {
  error?: string;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "Enter your email and password." };

  const session = await authenticate(email, password);
  if (!session) return { error: "Invalid email or password." };

  await createSessionCookie(session);
  redirect("/portfolio");
}

export async function signOutAction(): Promise<void> {
  clearSessionCookie();
  redirect("/sign-in");
}
