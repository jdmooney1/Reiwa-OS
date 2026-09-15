"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Boxes, Building2, LogOut, Landmark, Users, FileText , Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReiwaLockup } from "@/components/brand/reiwa-lockup";
import { signOutAction } from "@/app/actions/auth";

const ROLE_LABEL: Record<string, string> = {
  reiwa_admin: "Reiwa Admin",
  org_user: "Organisation User",
  investor_viewer: "Investor Viewer",
};

export function Sidebar({
  user,
  assets,
}: {
  user: { name: string; role: string };
  assets: { assetId: string; name: string }[];
}) {
  const pathname = usePathname();
  // The navigation spine of Reiwa OS: Opportunities, Investors, Assets, Firm.
  //
  // Named after the objects the firm actually works on rather than after the
  // modules they were built in — "Investment" and "Asset Intelligence" were
  // project names, and a person looking for a deal looks for the deal. Today is
  // deliberately absent: there is no dashboard yet, and a heading with nothing
  // behind it is worse than no heading.
  const sections = [
    { heading: "Opportunities", items: [{ href: "/pipeline", label: "Pipeline", icon: LayoutGrid }] },
    // Reiwa administrators only. The /admin layout and the database policies
    // both enforce this; hiding the section is presentation, not the control.
    ...(user.role === "reiwa_admin"
      ? [{
          heading: "Investors",
          items: [
            { href: "/admin", label: "Portal Overview", icon: Landmark },
            { href: "/admin/investors", label: "Investor Organisations", icon: Users },
            { href: "/admin/publications", label: "Publications", icon: FileText },
          ],
        }]
      : []),
    {
      heading: "Assets",
      items: [
        { href: "/portfolio", label: "Portfolio", icon: Boxes },
        ...assets.map((a) => ({ href: `/assets/${a.assetId}`, label: a.name, icon: Building2 })),
      ],
    },
    // Firm holds what belongs to the house rather than to one deal or one
    // investor. Today that is the audit trail; it is the section the rest of the
    // firm-level surfaces will join.
    ...(user.role === "reiwa_admin"
      ? [{
          heading: "Firm",
          items: [{ href: "/admin/activity", label: "Activity", icon: Activity }],
        }]
      : []),
  ];

  return (
    // Below `lg` the sidebar collapses to its icons. A fixed 240px rail on a
    // 390px phone left about 150px for the content, which technically did not
    // overflow and was of no use to anybody. Icons keep every destination
    // reachable without a toggle, a drawer or any client state.
    <aside className="flex w-14 shrink-0 flex-col border-r border-line bg-surface-card text-ink lg:w-60">
      <div className="py-3 lg:px-5 lg:py-7">
        <div className="hidden lg:block">
          <ReiwaLockup size="header" />
          <div className="eyebrow mt-3">Deal &amp; Asset Intelligence</div>
        </div>
        {/* No lockup in the collapsed rail. The brand module is explicit that
            the lockup is never cropped to the mark, and 56px cannot show it
            legibly — so it is omitted rather than altered. The wordmark returns
            with the full sidebar at lg. */}
      </div>

      <nav className="flex-1 overflow-y-auto px-1.5 lg:px-3">
        {sections.map((section) => (
          <div key={section.heading} className="mb-4">
            <div className="eyebrow hidden px-3 pb-1.5 lg:block">{section.heading}</div>
            {section.items.map(({ href, label, icon: Icon }) => {
              // "/admin" is a hub with siblings below it, so it matches exactly.
              const active = href === "/admin"
                ? pathname === "/admin"
                : pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group relative mb-0.5 flex items-center gap-3 rounded px-2.5 py-2 text-sm transition-colors lg:px-3",
                    active
                      ? "bg-purple-10 font-medium text-purple"
                      : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                  )}
                >
                  {active && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-purple" />}
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="hidden truncate lg:inline">{label}</span>
                  <span className="sr-only lg:hidden">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-1.5 py-3 lg:px-3">
        <div className="flex items-center gap-3 px-2 py-2 lg:px-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-2xs font-semibold text-ink-muted">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="hidden min-w-0 leading-tight lg:block">
            <div className="truncate text-xs text-ink">{user.name}</div>
            <div className="text-2xs text-ink-faint">{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded px-2.5 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink lg:px-3"
          >
            <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="hidden lg:inline">Sign out</span>
            <span className="sr-only lg:hidden">Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
