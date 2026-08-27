"use client";

import type { AssetFile } from "@/lib/asset-intelligence/types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardBody } from "@/components/ui/card";
import { AssetOverview } from "@/components/asset-intelligence/asset-overview";
import { PerformancePanel } from "@/components/asset-intelligence/performance-panel";

const PLANNED: Record<string, { phase: string; points: string[] }> = {
  leasing: { phase: "Phase 2", points: ["Rent roll, expiry profile, ERV vs passing", "Upcoming lease events, vacancy and leasing pipeline"] },
  capex: { phase: "Phase 2–3", points: ["Operating CapEx: budget / approved / committed / spent / forecast / variance", "Development: programme, workstreams, milestones, critical issues, programme variance"] },
  valuation: { phase: "Phase 2", points: ["Valuation history and movement", "Valuation bridge where data supports attribution"] },
  financing: { phase: "Phase 2", points: ["Loan terms, hedging, covenants (LTV / ICR / debt yield)", "Alerts: covenant pressure, maturity, refinancing, hedge expiry"] },
  risks: { phase: "Phase 3", points: ["Institutional risk register with probability × impact severity", "Auto-surfacing of highest risks to the executive dashboard"] },
  decisions: { phase: "Phase 3", points: ["Decision layer: issue, options, financial impact, recommendation, maker, deadline", "Decisions-required prominence over passive display"] },
  advisers: { phase: "Phase 3", points: ["Adviser directory by workstream and responsibility", "Actions linked to risks and decisions"] },
  reporting: { phase: "Phase 4", points: ["Monthly / quarterly / annual / IC reports from the same dataset", "AI management commentary and document intelligence"] },
};

export function AssetTabs({ file, canWrite = false }: { file: AssetFile; canWrite?: boolean }) {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
        <TabsTrigger value="leasing">Leasing</TabsTrigger>
        <TabsTrigger value="capex">CapEx / Development</TabsTrigger>
        <TabsTrigger value="valuation">Valuation</TabsTrigger>
        <TabsTrigger value="financing">Financing</TabsTrigger>
        <TabsTrigger value="risks">Risks</TabsTrigger>
        <TabsTrigger value="decisions">Decisions</TabsTrigger>
        <TabsTrigger value="advisers">Advisers &amp; Actions</TabsTrigger>
        <TabsTrigger value="reporting">Reporting</TabsTrigger>
      </TabsList>

      <div className="px-8 py-6">
        <TabsContent value="overview"><AssetOverview file={file} /></TabsContent>
        <TabsContent value="performance"><PerformancePanel file={file} canWrite={canWrite} /></TabsContent>
        {Object.entries(PLANNED).map(([key, cfg]) => (
          <TabsContent key={key} value={key}>
            <PlannedTab phase={cfg.phase} points={cfg.points} />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}

function PlannedTab({ phase, points }: { phase: string; points: string[] }) {
  return (
    <Card>
      <CardBody className="mx-auto max-w-2xl py-8">
        <div className="text-center">
          <span className="text-2xs font-medium uppercase tracking-label text-gold-deep">{phase}</span>
          <h3 className="mt-1 font-serif text-lg text-ink">Planned module</h3>
          <p className="mt-1 text-xs text-ink-muted">
            The data model and demonstration records already exist for this module; the interface is delivered in {phase}.
          </p>
        </div>
        <ul className="mx-auto mt-5 max-w-md space-y-2">
          {points.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-ink/90">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              {p}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
