"use client";

import type { DealFile } from "@/types/database";
import type { DealNarrative } from "@/lib/mock-data";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OverviewTab } from "./tabs/overview-tab";
import { FinancialsTab } from "./tabs/financials-tab";
import { DueDiligenceTab } from "./tabs/due-diligence-tab";
import { RisksTab } from "./tabs/risks-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { ContactsTab } from "./tabs/contacts-tab";
import { DecisionLogTab } from "./tabs/decision-log-tab";
import { MemoTab } from "./tabs/memo-tab";

export function DealTabs({
  file,
  narrative,
}: {
  file: DealFile;
  narrative?: DealNarrative;
}) {
  const count = (n: number) => (n > 0 ? ` (${n})` : "");
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="financials">Financials</TabsTrigger>
        <TabsTrigger value="dd">Due Diligence{count(file.dueDiligence.length)}</TabsTrigger>
        <TabsTrigger value="risks">Risks{count(file.risks.length)}</TabsTrigger>
        <TabsTrigger value="documents">Documents{count(file.documents.length)}</TabsTrigger>
        <TabsTrigger value="contacts">Contacts{count(file.contacts.length)}</TabsTrigger>
        <TabsTrigger value="decisions">Decision Log{count(file.decisions.length)}</TabsTrigger>
        <TabsTrigger value="memo">Memo</TabsTrigger>
      </TabsList>

      <div className="px-8 py-6">
        <TabsContent value="overview">
          <OverviewTab deal={file.deal} narrative={narrative} />
        </TabsContent>
        <TabsContent value="financials">
          <FinancialsTab deal={file.deal} metrics={file.metrics} />
        </TabsContent>
        <TabsContent value="dd">
          <DueDiligenceTab deal={file.deal} items={file.dueDiligence} />
        </TabsContent>
        <TabsContent value="risks">
          <RisksTab risks={file.risks} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab documents={file.documents} />
        </TabsContent>
        <TabsContent value="contacts">
          <ContactsTab contacts={file.contacts} />
        </TabsContent>
        <TabsContent value="decisions">
          <DecisionLogTab decisions={file.decisions} />
        </TabsContent>
        <TabsContent value="memo">
          <MemoTab file={file} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
