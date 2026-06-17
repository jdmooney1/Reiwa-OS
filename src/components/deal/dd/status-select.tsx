"use client";

import type { DdStatus } from "@/types/database";
import { DD_STATUS_LABEL, DD_STATUS_ORDER, DD_STATUS_TONE, type Tone } from "@/lib/domain";
import { cn } from "@/lib/utils";

const TONE_DOT: Record<Tone, string> = {
  positive: "bg-positive", caution: "bg-caution", negative: "bg-negative",
  gold: "bg-gold", neutral: "bg-ink-faint", muted: "bg-ink-faint",
};

const TONE_TEXT: Record<Tone, string> = {
  positive: "text-positive", caution: "text-caution", negative: "text-negative",
  gold: "text-gold-deep", neutral: "text-ink", muted: "text-ink-muted",
};

/** Inline status control — reads like a chip, edits like a select. */
export function StatusSelect({
  status,
  onChange,
}: {
  status: DdStatus;
  onChange: (status: DdStatus) => void;
}) {
  const tone = DD_STATUS_TONE[status];
  return (
    <div className="relative inline-flex items-center">
      <span className={cn("pointer-events-none absolute left-2 h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as DdStatus)}
        className={cn(
          "h-7 cursor-pointer appearance-none rounded border border-line bg-surface-card pl-5 pr-6 text-2xs font-medium",
          "focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30",
          TONE_TEXT[tone],
        )}
      >
        {DD_STATUS_ORDER.map((s) => (
          <option key={s} value={s} className="text-ink">
            {DD_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-1.5 h-3 w-3 text-ink-faint" viewBox="0 0 12 12" fill="none">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    </div>
  );
}
