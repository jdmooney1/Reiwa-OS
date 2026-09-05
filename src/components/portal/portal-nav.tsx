"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { readCompare, onCompareChange } from "@/lib/portal/compare-store";

const ITEMS = [
  { href: "/portal", label: "Opportunities" },
  { href: "/portal/saved", label: "Saved" },
  { href: "/portal/compare", label: "Compare" },
] as const;

export function PortalNav() {
  const pathname = usePathname();
  const [compareCount, setCompareCount] = useState(0);

  // Read after mount so the server and first client render agree.
  useEffect(() => {
    const sync = () => setCompareCount(readCompare().length);
    sync();
    return onCompareChange(sync);
  }, []);

  return (
    <nav aria-label="Portal" className="flex items-center gap-1">
      {ITEMS.map((item) => {
        const active = item.href === "/portal"
          ? pathname === "/portal" || pathname.startsWith("/portal/opportunities")
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative px-3 py-3 text-xs font-medium tracking-wide transition-colors",
              active ? "text-surface" : "text-surface/55 hover:text-surface/85",
            )}
          >
            {item.label}
            {item.label === "Compare" && compareCount > 0 && (
              <span className="ml-1.5 rounded-sm bg-gold/20 px-1.5 py-0.5 text-2xs font-semibold text-gold-soft">
                {compareCount}
              </span>
            )}
            {active && (
              <span className="absolute inset-x-3 -bottom-px h-px bg-gold" aria-hidden="true" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
