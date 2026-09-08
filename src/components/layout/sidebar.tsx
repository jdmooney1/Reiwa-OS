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
  const sections = [
    { heading: "Investment", items: [{ href: "/pipeline", label: "Pipeline", icon: LayoutGrid }] },
    {
      heading: "Asset Intelligence",
      items: [
        { href: "/portfolio", label: "Portfolio", icon: Boxes },
        ...assets.map((a) => ({ href: `/assets/${a.assetId}`, label: a.name, icon: Building2 })),
      ],
    },
    // The Investment Portal admin surface — Reiwa administrators only. The
    // /admin layout and the database policies both enforce this; hiding the
    // section is presentation, not the control.
    ...(user.role === "reiwa_admin"
      ? [{
          heading: "Investment Portal",
          items: [
            { href: "/admin", label: "Portal Overview", icon: Landmark },
            { href: "/admin/investors", label: "Investors", icon: Users },
            { href: "/admin/publications", label: "Publications", icon: FileText },
            { href: "/admin/activity", label: "Activity", icon: Activity },
          ],
        }]
      : []),
  ];

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-card text-ink">
      <div className="px-5 py-7">
        <ReiwaLockup size="header" />
        <div className="eyebrow mt-3">Deal &amp; Asset Intelligence</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        {sections.map((section) => (
          <div key={section.heading} className="mb-4">
            <div className="eyebrow px-3 pb-1.5">{section.heading}</div>
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
                    "group relative mb-0.5 flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-purple-10 font-medium text-purple"
                      : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                  )}
                >
                  {active && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-purple" />}
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-sunken text-2xs font-semibold text-ink-muted">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-xs text-ink">{user.name}</div>
            <div className="text-2xs text-ink-faint">{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
