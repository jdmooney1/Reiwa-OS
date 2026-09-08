import { cn } from "@/lib/utils";

/** A single figure in the key-metrics strip or a metrics grid. */
export function MetricTile({
  label,
  value,
  sub,
  dark = false,
  align = "left",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  dark?: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className={cn(align === "right" && "text-right")}>
      <div
        className={cn(
          "text-2xs font-medium uppercase tracking-label",
          dark ? "text-ink-faint" : "text-ink-faint",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "tabular mt-1 text-lg font-medium",
          dark ? "text-ink" : "text-ink",
        )}
      >
        {value}
      </div>
      {sub && (
        <div
          className={cn(
            "tabular text-xs",
            dark ? "text-ink-faint" : "text-ink-faint",
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
