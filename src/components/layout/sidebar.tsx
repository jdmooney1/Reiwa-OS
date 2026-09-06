"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Boxes, Building2, LogOut, Landmark, Users, FileText , Activity } from "lucide-react";
import { cn } from "@/lib/utils";
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
    <aside className="flex w-56 shrink-0 flex-col border-r border-line-dark bg-navy text-surface">
      <div className="px-5 py-6">
        <div className="font-serif text-lg tracking-wide text-surface">
          REIWA<span className="text-gold"> OS</span>
        </div>
        <div className="eyebrow-light mt-1">Deal &amp; Asset Intelligence</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        {sections.map((section) => (
          <div key={section.heading} className="mb-4">
            <div className="eyebrow-light px-3 pb-1.5">{section.heading}</div>
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
                    active ? "bg-white/5 text-surface" : "text-surface/60 hover:bg-white/5 hover:text-surface",
                  )}
                >
                  {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold" />}
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line-dark px-3 py-3">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/20 text-2xs font-semibold text-gold-soft">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-xs text-surface">{user.name}</div>
            <div className="text-2xs text-surface/40">{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-surface/60 hover:bg-white/5 hover:text-surface"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
