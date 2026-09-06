"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { REPORTABLE_EVENTS } from "@/lib/activity-events";
import type { ActivityFilterOptions } from "@/lib/data/admin-activity";
import { EVENT_LABEL } from "@/lib/activity-labels";

const FIELD =
  "rounded border border-line bg-surface-card px-2.5 py-1.5 text-xs text-ink focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30";

/**
 * The filters, held entirely in the URL so the page stays a server render and
 * a filtered view can be linked to or reloaded.
 */
export function ActivityFilterBar({ options }: { options: ActivityFilterOptions }) {
  const router = useRouter();
  const params = useSearchParams();

  const value = (key: string) => params.get(key) ?? "";
  const orgFilter = value("org");

  // Contacts narrow to the chosen organisation, so the two filters agree.
  const contacts = orgFilter
    ? options.contacts.filter((c) => c.investorOrgId === orgFilter)
    : options.contacts;

  function apply(key: string, next: string) {
    const q = new URLSearchParams(params.toString());
    if (next) q.set(key, next); else q.delete(key);
    // Changing organisation invalidates a contact from another one.
    if (key === "org") q.delete("contact");
    q.delete("page");
    router.replace(`/admin/activity${q.toString() ? `?${q}` : ""}`);
  }

  const active = ["org", "contact", "publication", "type", "from", "to"].some((k) => value(k));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded border border-line bg-surface-sunken/40 px-4 py-3">
      <Field label="Investor">
        <select className={FIELD} value={orgFilter} onChange={(e) => apply("org", e.target.value)}>
          <option value="">All investors</option>
          {options.organisations.map((o) => (
            <option key={o.investorOrgId} value={o.investorOrgId}>{o.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Contact">
        <select className={FIELD} value={value("contact")} onChange={(e) => apply("contact", e.target.value)}>
          <option value="">All contacts</option>
          {contacts.map((c) => (
            <option key={c.investorContactId} value={c.investorContactId}>{c.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Opportunity">
        <select className={FIELD} value={value("publication")} onChange={(e) => apply("publication", e.target.value)}>
          <option value="">All opportunities</option>
          {options.publications.map((p) => (
            <option key={p.publicationId} value={p.publicationId}>{p.title}</option>
          ))}
        </select>
      </Field>

      <Field label="Action">
        <select className={FIELD} value={value("type")} onChange={(e) => apply("type", e.target.value)}>
          <option value="">All actions</option>
          {REPORTABLE_EVENTS.map((t) => (
            <option key={t} value={t}>{EVENT_LABEL[t]}</option>
          ))}
        </select>
      </Field>

      <Field label="From">
        <input type="date" className={FIELD} value={value("from")}
          onChange={(e) => apply("from", e.target.value)} />
      </Field>

      <Field label="To">
        <input type="date" className={FIELD} value={value("to")}
          onChange={(e) => apply("to", e.target.value)} />
      </Field>

      {active && (
        <button
          type="button"
          onClick={() => router.replace("/admin/activity")}
          className="pb-1.5 text-2xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs uppercase tracking-label text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
