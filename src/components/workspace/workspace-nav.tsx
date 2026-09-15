"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Section navigation for one opportunity file.
 *
 * Real links, not client-side tab state: a section of an investment file is
 * something you send to a colleague, and a URL that does not name what you are
 * looking at cannot be sent. It also means each section is server-rendered and
 * fetches only its own data.
 *
 * Counts appear only where a number changes what you would do next — open
 * diligence, open risks. A count of documents tells nobody anything, so there
 * isn't one.
 */
interface Counts {
  ddOpen: number;
  ddIssues: number;
  ddOverdue: number;
  ddTotal: number;
  risksOpen: number;
  decisions: number;
  documents: number;
}

export function WorkspaceNav({
  opportunityId, counts,
}: {
  opportunityId: string;
  counts: Counts;
}) {
  const pathname = usePathname();
  const base = `/opportunities/${opportunityId}`;

  const sections: { href: string; label: string; badge?: number; tone?: "issue" }[] = [
    { href: base, label: "Summary" },
    { href: `${base}/underwriting`, label: "Underwriting" },
    {
      href: `${base}/diligence`,
      label: "Due diligence",
      badge: counts.ddTotal > 0 ? counts.ddOpen : undefined,
      // A passed date turns the badge red for the same reason a flagged finding
      // does: both mean somebody is waiting, and neither should need a click.
      tone: counts.ddIssues > 0 || counts.ddOverdue > 0 ? "issue" : undefined,
    },
    {
      href: `${base}/risks`,
      label: "Risks",
      badge: counts.risksOpen > 0 ? counts.risksOpen : undefined,
      tone: counts.risksOpen > 0 ? "issue" : undefined,
    },
    { href: `${base}/documents`, label: "Documents" },
    { href: `${base}/decision`, label: "Decision" },
    { href: `${base}/publication`, label: "Publication" },
  ];

  return (
    <nav className="mt-4 flex gap-1 overflow-x-auto px-6 sm:px-8" aria-label="Opportunity sections">
      {sections.map((s) => {
        const active = s.href === base ? pathname === base : pathname.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
              active
                ? "border-purple text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {s.label}
            {s.badge != null && s.badge > 0 && (
              <span className={cn(
                "tabular rounded px-1.5 py-0.5 text-2xs font-semibold",
                s.tone === "issue"
                  ? "bg-negative/10 text-negative"
                  : "bg-surface-sunken text-ink-muted",
              )}>
                {s.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
