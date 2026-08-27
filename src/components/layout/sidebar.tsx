"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid, Briefcase, Users, Settings, FileText, Building2, Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listAssets } from "@/lib/asset-intelligence/mock";

const NAV_SECTIONS: {
  heading: string;
  items: { href: string; label: string; icon: React.ElementType }[];
}[] = [
  {
    heading: "Deal Flow",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: LayoutGrid },
      { href: "/deals", label: "Deals", icon: Briefcase },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/memo", label: "Memos", icon: FileText },
    ],
  },
  {
    heading: "Asset Intelligence",
    items: [
      { href: "/portfolio", label: "Portfolio", icon: Boxes },
      ...listAssets().map((a) => ({
        href: `/assets/${a.asset_id}`,
        label: a.name,
        icon: Building2,
      })),
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line-dark bg-navy text-surface">
      <div className="px-5 py-6">
        <div className="font-serif text-lg tracking-wide text-surface">
          REIWA<span className="text-gold"> OS</span>
        </div>
        <div className="eyebrow-light mt-1">Deal Intelligence</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading} className="mb-4">
            <div className="eyebrow-light px-3 pb-1.5">{section.heading}</div>
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group relative mb-0.5 flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-white/5 text-surface"
                      : "text-surface/60 hover:bg-white/5 hover:text-surface",
                  )}
                >
                  {active && (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold" />
                  )}
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line-dark px-3 py-3">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded px-3 py-2 text-sm text-surface/60 hover:bg-white/5 hover:text-surface"
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
          Settings
        </Link>
        <div className="mt-2 flex items-center gap-3 px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/20 text-2xs font-semibold text-gold-soft">
            JM
          </div>
          <div className="leading-tight">
            <div className="text-xs text-surface">JD Mooney</div>
            <div className="text-2xs text-surface/40">Founder</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
