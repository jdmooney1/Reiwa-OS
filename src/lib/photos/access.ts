// ============================================================================
// Who may be served a photograph - a pure rule, re-evaluated on every request.
// ----------------------------------------------------------------------------
// Phase 1 is STAFF ONLY. Internal staff (reiwa_admin, reiwa_staff, org_user) may read a photo
// at every visibility, because to them `visibility` is a label about the future,
// not a restriction. Everyone else - including the read-only `investor_viewer`
// role and any portal contact - may read NO photograph at ANY visibility.
//
// This is deliberately stricter than "up to their entitlement tier": no investor
// path exists yet, so there is no tier to compare. Phase 2 adds one by extending
// this function and the delivery route together, in one reviewed change that
// also has to update tests/unit/investor-no-photos.test.ts.
//
// Imports nothing but a type, so a test can run it without a database.
// ============================================================================
import type { GlobalRole } from "@/lib/db/client";
import type { PhotoVisibility } from "@/lib/photos/constraints";

export function mayReadPhoto(role: GlobalRole | null | undefined, _visibility: PhotoVisibility): boolean {
  return role === "reiwa_admin" || role === "reiwa_staff" || role === "org_user";
}
