import Link from "next/link";
import { portalSignOutAction } from "@/app/actions/portal-access";
import { PortalNav } from "@/components/portal/portal-nav";
import type { PortalIdentity } from "@/lib/auth/portal-session";

/**
 * The authenticated investor frame: brand, the three investor destinations, and
 * the signed-in identity. No internal Reiwa OS navigation appears here, and
 * none of the internal surfaces are reachable from it.
 */
export function PortalShell({
  investor, children,
}: {
  investor: PortalIdentity;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="bg-navy">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-4">
            <Link href="/portal" className="group flex items-baseline gap-3">
              <span className="font-serif text-lg tracking-wide text-surface">
                REIWA<span className="text-gold"> CAPITAL</span>
              </span>
              <span className="hidden text-2xs uppercase tracking-label text-surface/60 sm:inline">
                Investment Portal
              </span>
            </Link>

            <div className="flex items-center gap-4">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-xs font-medium text-surface/90">{investor.investorOrgName}</div>
                <div className="text-2xs text-surface/60">{investor.name}</div>
              </div>
              <form action={portalSignOutAction}>
                <button
                  type="submit"
                  className="rounded border border-white/15 px-3 py-1.5 text-2xs font-medium text-surface/70 transition-colors hover:border-gold/40 hover:text-surface"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <div className="border-t border-line-dark">
            <PortalNav />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-6 py-6">
          <p className="max-w-3xl text-2xs leading-relaxed text-ink-faint">
            Private &amp; confidential — prepared for {investor.investorOrgName}. The information in
            this portal is provided for evaluation by the named recipient only and does not
            constitute an offer, an invitation to invest, or investment advice. Targets and
            projections are estimates, not guarantees, and capital is at risk.
          </p>
        </div>
      </footer>
    </div>
  );
}

/** The section masthead used at the top of each portal page. */
export function PortalPageHeader({
  eyebrow, title, lede, aside,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="font-serif text-2xl leading-tight text-ink">{title}</h1>
        {lede && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{lede}</p>}
      </div>
      {aside}
    </header>
  );
}
