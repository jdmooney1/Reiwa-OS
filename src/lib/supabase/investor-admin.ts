// ============================================================================
// Investor Auth provisioning (P3) — SERVER-ONLY, Admin API.
// ----------------------------------------------------------------------------
// Pre-provisions the Supabase Auth identity behind an investor contact. The
// account is created WITHOUT a password: the only way into it is the email OTP
// flow, and the only mailbox that receives codes is the authorised address.
// There is no self-registration path anywhere — signInWithOtp always runs with
// shouldCreateUser: false, so this function is the single place investor Auth
// users come from.
// ============================================================================
import { createSupabaseAdminClient, findAuthUserByEmail } from "@/lib/supabase/admin";

/**
 * Idempotently ensure a passwordless Supabase Auth user exists for an investor
 * contact's email, returning its id. An existing account (any kind) is reused
 * by id — Supabase Auth enforces one user per email.
 */
export async function provisionInvestorAuthUser(email: string, name: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) return existing;

  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim(),
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) {
    throw new Error(
      `Could not provision investor Auth user ${email}: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}
