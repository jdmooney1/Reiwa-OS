"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Landmark, Loader2 } from "lucide-react";
import type { VersionProvenance } from "@/lib/data/investor-portal";
import type { PublicationEntitlementRow } from "@/lib/data/admin-portal";
import { preparePublicationAction } from "@/app/actions/admin-portal";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Section, FactList, TableWrap, Th, Td, Empty, Provenance } from "@/components/workspace/primitives";
import { IC_OUTCOME_LABEL } from "@/lib/workspace/labels";
import type { IcOutcome } from "@/lib/data/ic-decisions";

export interface PublicationView {
  publicationId: string;
  status: string;
  activeVersionNumber: number | null;
  activeVersionTitle: string | null;
  activeVersionStatus: string | null;
  publishedAt: string | null;
  provenance: VersionProvenance | null;
  entitlements: PublicationEntitlementRow[];
  sourceChanged: boolean;
}

/**
 * The opportunity's relationship to the investor portal.
 *
 * Read-mostly on purpose. The publication system is not rebuilt here: this
 * section shows what exists and hands off to the admin screen that owns it.
 * The one action offered is the existing "prepare a draft" workflow.
 *
 * The important thing this screen says out loud is that a publication is a
 * SNAPSHOT. Revising underwriting on this opportunity does not reach a version
 * an investor has already been shown — so when the internal record has moved
 * on, the honest answer is "the source has changed since this was taken", not
 * a silently updated figure.
 */
export function PublicationSection({
  opportunityId, publication, portalAdmin,
}: {
  opportunityId: string;
  publication: PublicationView | null;
  portalAdmin: boolean;
}) {
  const [pending, start] = useTransition();

  if (!portalAdmin) {
    return (
      <Section eyebrow="Investors" title="Investor publication">
        <Empty
          title="Investor publication is administered by Reiwa administrators."
          hint="Nothing about this opportunity is visible to investors unless a publication has been prepared and entitled."
        />
      </Section>
    );
  }

  if (!publication) {
    return (
      <Section eyebrow="Investors" title="Nothing prepared for investors">
        <Empty
          title="This opportunity has never been published."
          hint="Preparing a draft copies approved fields into a separate investor-facing version. It does not expose the internal record."
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => preparePublicationAction(opportunityId))}
          className="mt-4 flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Landmark className="h-3.5 w-3.5" />}
          Prepare investor draft
        </button>
      </Section>
    );
  }

  const p = publication;
  const visible = p.entitlements.filter((e) => e.isVisible);

  return (
    <div>
      <Section
        eyebrow="Investors"
        title="Investor publication"
        action={
          <Link href={`/admin/publications/${p.publicationId}`}
            className="rounded border border-line px-3 py-1.5 text-2xs font-medium text-ink-muted hover:text-ink">
            Open in portal admin →
          </Link>
        }
      >
        <FactList items={[
          { k: "Publication status", v: <Badge tone={p.status === "published" ? "positive" : "muted"}>{p.status}</Badge> },
          { k: "Current version", v: p.activeVersionNumber != null
              ? `v${p.activeVersionNumber}${p.activeVersionTitle ? ` · ${p.activeVersionTitle}` : ""}`
              : "No published version" },
          { k: "Published", v: formatDate(p.publishedAt) },
          { k: "Entitled organisations", v: visible.length === 0 ? "None" : String(visible.length) },
        ]} />
        {p.sourceChanged && (
          <p className="mt-3 border-l-2 border-caution pl-3 text-xs leading-relaxed text-ink-muted">
            The internal record has changed since this version was taken. The investor
            version is unaffected — a publication is a snapshot, not a mirror. Issue a
            new version in portal admin if investors should see the revised position.
          </p>
        )}
      </Section>

      <Section eyebrow="Provenance" title="What this version was taken from">
        {p.provenance ? (
          <FactList items={[
            { k: "Captured", v: formatDate(p.provenance.sourceCapturedAt) },
            { k: "Underwriting version", v: p.provenance.sourceCaseVersion != null
                ? `v${p.provenance.sourceCaseVersion} (${p.provenance.sourceCaseStatus})`
                : "Not underwritten at capture" },
            { k: "Committee decision", v: p.provenance.sourceDecisionOutcome
                ? `${IC_OUTCOME_LABEL[p.provenance.sourceDecisionOutcome as IcOutcome]} · ${formatDate(p.provenance.sourceDecisionDate)}`
                : "Not decided at capture" },
          ]} />
        ) : (
          <Empty title="No provenance recorded for this version." />
        )}
        <Provenance>
          Once cited here, an underwriting version or a decision can no longer be deleted.
        </Provenance>
      </Section>

      <Section eyebrow="Access" title="Who can see this">
        {p.entitlements.length === 0 ? (
          <Empty
            title="No investor organisation has been entitled."
            hint="A published version is invisible until an organisation is granted access."
          />
        ) : (
          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Investor organisation</Th>
                  <Th>Visible</Th>
                  <Th>Placement</Th>
                  <Th>Document access</Th>
                </tr>
              </thead>
              <tbody>
                {p.entitlements.map((e) => (
                  <tr key={e.investorOrgId}>
                    <Td>{e.investorOrgName}</Td>
                    <Td>
                      <Badge tone={e.isVisible ? "positive" : "muted"}>
                        {e.isVisible ? "Visible" : "Hidden"}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-ink-muted">{e.placement}</Td>
                    <Td className="text-xs text-ink-muted">{e.documentAccessLevel}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
