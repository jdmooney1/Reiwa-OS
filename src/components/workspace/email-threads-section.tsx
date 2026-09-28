"use client";

import { useTransition } from "react";
import { Mail, ExternalLink, Check, HelpCircle } from "lucide-react";
import type { OpportunityThread } from "@/lib/data/email-threads";
import { confirmThreadLinkAction } from "@/app/actions/workspace";
import { Badge } from "@/components/ui/badge";
import { Section, TableWrap, Th, Td, Empty, Provenance } from "@/components/workspace/primitives";

/**
 * The broker correspondence behind an opportunity.
 *
 * This section links; it does not copy. The thread stays in Gmail and the deep
 * link is composed from its id at render time, so nothing here goes stale when
 * a mailbox changes and no message content is duplicated into Reiwa OS. What
 * the emails actually SAY — tenant covenant, lease term, break, rent review —
 * is a separate extraction phase with its own design.
 *
 * A `review` link is evidence offered, not a fact asserted. It is shown, because
 * withholding it would lose the lead, but it is visibly unconfirmed until
 * somebody agrees: the matcher once paired "16 Conduit Street" with
 * "9 Conduit Street" on nothing more than a shared street name.
 */
export function EmailThreadsSection({
  opportunityId, threads, canWrite,
}: {
  opportunityId: string;
  threads: OpportunityThread[];
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const unconfirmed = threads.filter((t) => !t.confirmedAt && t.confidence === "review").length;

  return (
    <Section
      eyebrow="Correspondence"
      title="Broker email"
      action={
        unconfirmed > 0
          ? <Badge tone="caution">{unconfirmed} to confirm</Badge>
          : threads.length > 0
            ? <Badge tone="muted">{threads.length} thread{threads.length === 1 ? "" : "s"}</Badge>
            : null
      }
    >
      {threads.length === 0 ? (
        <Empty
          title="No email thread is linked to this opportunity."
          hint="Most loaded deals have none. The labelled corpus covers 68 threads against 132 deals, and more exist unlabelled - absence here is expected rather than a gap."
        />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>Thread</Th>
                <Th>Matched on</Th>
                <Th>Status</Th>
                <Th className="text-right">Open</Th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => (
                <tr key={t.emailThreadId}>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      {t.subject ?? "Untitled thread"}
                    </span>
                  </Td>
                  <Td className="text-ink-muted">{t.matchedSubject ?? "—"}</Td>
                  <Td>
                    {t.confirmedAt ? (
                      <Badge tone="positive" dot>Confirmed</Badge>
                    ) : t.confidence === "high" ? (
                      <Badge tone="neutral">High confidence</Badge>
                    ) : (
                      <Badge tone="caution" dot>Needs confirming</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="inline-flex items-center gap-2">
                      {canWrite && !t.confirmedAt && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => start(async () => {
                            await confirmThreadLinkAction(opportunityId, t.emailThreadId, true);
                          })}
                          className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-2xs font-medium text-ink-muted hover:border-gold/40 hover:text-ink disabled:opacity-50"
                        >
                          <Check className="h-3 w-3" /> Confirm
                        </button>
                      )}
                      <a
                        href={t.gmailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-2xs font-medium text-ink hover:border-gold/40"
                      >
                        View original email <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          {unconfirmed > 0 && (
            <Provenance>
              <span className="inline-flex items-start gap-1.5">
                <HelpCircle className="mt-px h-3 w-3 shrink-0" />
                <span>
                  A thread marked <strong>needs confirming</strong> was matched on the
                  subject line alone. Open it before confirming: a shared street name is
                  not a shared building.
                </span>
              </span>
            </Provenance>
          )}
        </>
      )}
    </Section>
  );
}
