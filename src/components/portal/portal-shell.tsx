import Link from "next/link";
import { portalSignOutAction } from "@/app/actions/portal-access";
import { PortalNav } from "@/components/portal/portal-nav";
import { ReiwaLockup } from "@/components/brand/reiwa-lockup";
import type { PortalIdentity } from "@/lib/auth/portal-session";

/**
 * The authenticated investor frame: the mark, the three investor destinations,
 * and the signed-in identity. No internal Reiwa OS navigation appears here,
 * none of the internal surfaces are reachable from it, and the words "Reiwa OS"
 * appear nowhere an investor can see — this is the Reiwa Capital Investment
 * Portal, and the internal product's name is not theirs to know.
 *
 * The masthead is cream, not a dark band. The lockup carries the identity; the
 * only colour is the purple rule under the active destination.
 */
export function PortalShell({
  investor, children,
}: {
  investor: PortalIdentity;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-line">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pb-5 pt-7">
            <Link href="/portal" aria-label="Reiwa Capital Investment Portal" className="block">
              <ReiwaLockup size="header" />
              <span className="mt-2 block text-2xs uppercase tracking-eyebrow text-ink-faint">
                Investment Portal
              </span>
            </Link>

            <div className="flex items-center gap-5">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-xs font-medium text-ink">{investor.investorOrgName}</div>
                <div className="mt-0.5 text-2xs text-ink-faint">{investor.name}</div>
              </div>
              <form action={portalSignOutAction}>
                <button
                  type="submit"
                  className="rounded border border-line-strong px-3 py-1.5 text-2xs font-medium text-ink-muted transition-colors hover:border-purple hover:text-purple"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <PortalNav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-section">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
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

/**
 * The masthead at the top of each portal page.
 *
 * `eyebrow` states who the page was prepared for and nothing more. It is
 * deliberately not a recommendation: "Prepared for" is a statement of
 * provenance, where the old navy "Selected for your review" banner implied
 * Reiwa had judged the opportunity suitable for the reader.
 */
export function PortalPageHeader({
  eyebrow, title, lede, aside,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-line-strong pb-6">
      <div>
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-3xl leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {lede && (
          <p className="mt-3 max-w-measure text-sm leading-relaxed text-ink-muted">{lede}</p>
        )}
      </div>
      {aside}
    </header>
  );
}
