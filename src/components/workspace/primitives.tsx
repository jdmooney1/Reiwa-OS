import { cn } from "@/lib/utils";

/**
 * The workspace's shared furniture.
 *
 * Deliberately small and deliberately plain: rules, labels and tables. An
 * investment file is read top-to-bottom by someone deciding whether to commit
 * money, so the page's job is hierarchy and density, not decoration. There are
 * no tiles, no cards-within-cards and no charts here, and that is the design
 * rather than an omission.
 */

/** A titled band with a rule above it. The unit every section is built from. */
export function Section({
  title, eyebrow, action, children, className,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t border-line px-6 py-6 first:border-t-0 sm:px-8", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A horizontal metrics rule — the institutional alternative to a tile grid.
 * Figures sit on one baseline, separated by hairlines, so they read as a
 * single statement rather than nine competing boxes.
 */
export function MetricRule({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 divide-x divide-y divide-line border-y border-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
      {items.map((m) => (
        <div key={m.label} className="px-4 py-3">
          <dt className="text-2xs uppercase tracking-label text-ink-faint">{m.label}</dt>
          <dd className="tabular mt-0.5 text-base text-ink">{m.value}</dd>
          {m.sub && <div className="text-2xs text-ink-faint">{m.sub}</div>}
        </div>
      ))}
    </dl>
  );
}

/** A definition list for metadata: label left, value right, hairline between. */
export function FactList({ items }: { items: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line border-y border-line">
      {items.map((f) => (
        <div key={f.k} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="shrink-0 text-2xs uppercase tracking-label text-ink-faint">{f.k}</dt>
          <dd className="text-right text-sm text-ink">{f.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tables are tables. Horizontal scroll is contained, never on the page body. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-6 overflow-x-auto sm:mx-0">
      <div className="min-w-[44rem] px-6 sm:min-w-0 sm:px-0">{children}</div>
    </div>
  );
}

export function Th({ children, align = "left", className }: {
  children?: React.ReactNode; align?: "left" | "right"; className?: string;
}) {
  return (
    <th scope="col" className={cn(
      "border-b border-line pb-2 pr-4 text-2xs font-medium uppercase tracking-label text-ink-faint last:pr-0",
      align === "right" ? "text-right" : "text-left", className,
    )}>
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className }: {
  children?: React.ReactNode; align?: "left" | "right"; className?: string;
}) {
  return (
    <td className={cn(
      "border-b border-line py-2.5 pr-4 align-top text-sm text-ink last:pr-0",
      align === "right" ? "tabular text-right" : "text-left", className,
    )}>
      {children}
    </td>
  );
}

/**
 * What a section says when it has nothing to show.
 *
 * Always states what is absent and what would create it. "No risks recorded" is
 * a fact; a blank panel is an ambiguity between "none" and "not loaded".
 */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border border-dashed border-line px-5 py-8 text-center">
      <p className="text-sm text-ink-muted">{title}</p>
      {hint && <p className="mt-1 text-2xs text-ink-faint">{hint}</p>}
    </div>
  );
}

/** A quiet note attached to a figure — where it came from, what it assumes. */
export function Provenance({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs text-ink-faint">{children}</p>;
}

/**
 * What went wrong with the thing you just tried, said where you tried it.
 *
 * One component, used by every workspace write, so a recoverable failure looks
 * the same wherever it happens and no section invents its own treatment. It
 * renders nothing when there is nothing to say, so a call site is one line and
 * cannot forget the empty case.
 *
 * `role="alert"` because the message usually appears without the focus moving —
 * a screen reader would otherwise never learn the submission failed.
 *
 * Only ever passed a message that has been through the classification in
 * @/lib/actions/result, which is what makes it safe to display.
 */
export function ActionError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="border-l-2 border-negative pl-3 text-xs leading-relaxed text-negative">
      {message}
    </p>
  );
}
