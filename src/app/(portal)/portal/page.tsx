import { ShieldCheck } from "lucide-react";
import { requirePortalSession } from "@/lib/auth/portal-session";
import { portalSignOutAction } from "@/app/actions/portal-access";

export const dynamic = "force-dynamic";

// P3's deliberately minimal holding page: confirms access and identity only.
// The portal experience itself — opportunities, saved, compare, dashboard —
// is P4 and is intentionally absent here.
export default async function PortalHomePage() {
  const investor = await requirePortalSession();

  return (
    <div className="rounded-lg border border-line bg-surface-card px-7 py-7">
      <div className="flex items-center gap-2 text-positive">
        <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
        <span className="text-xs font-semibold uppercase tracking-label">Access confirmed</span>
      </div>
      <h1 className="mt-3 font-serif text-xl text-ink">Welcome, {investor.name}</h1>
      <dl className="mt-4 divide-y divide-line rounded border border-line">
        <Row k="Signed in as" v={investor.email} />
        {investor.title && <Row k="Title" v={investor.title} />}
        <Row k="Organisation" v={investor.investorOrgName} />
      </dl>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted">
        Your access to the Reiwa Capital investment portal is active. Your investment
        opportunities will appear here when the portal experience opens.
      </p>
      <form action={portalSignOutAction} className="mt-6">
        <button type="submit"
          className="rounded border border-line px-4 py-2 text-xs font-medium text-ink-muted hover:border-gold/40 hover:text-ink">
          Sign out
        </button>
      </form>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-2xs uppercase tracking-label text-ink-faint">{k}</dt>
      <dd className="text-sm text-ink">{v}</dd>
    </div>
  );
}
