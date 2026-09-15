"use client";

// ============================================================================
// Asset file tabs.
// ----------------------------------------------------------------------------
// Two tabs, because there are two things the database can actually answer.
//
// There were ten. The other eight rendered a "Planned module" card claiming
// "the data model and demonstration records already exist for this module" —
// for leases, capex, developments, financing, advisers and actions, none of
// which has a table, a column or a row anywhere in the schema. A roadmap
// dressed as a disabled feature is worse than an absent one: it invites
// somebody to sell a capability that does not exist, and it makes the product
// look thin in nine places instead of complete in two.
//
// Where the module genuinely arrives, the tab arrives with it.
// ============================================================================
import type { AssetFile } from "@/lib/asset-intelligence/types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AssetOverview } from "@/components/asset-intelligence/asset-overview";
import { PerformancePanel } from "@/components/asset-intelligence/performance-panel";

export function AssetTabs({ file, canWrite = false }: { file: AssetFile; canWrite?: boolean }) {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
      </TabsList>

      <div className="px-8 py-6">
        <TabsContent value="overview"><AssetOverview file={file} /></TabsContent>
        <TabsContent value="performance"><PerformancePanel file={file} canWrite={canWrite} /></TabsContent>
      </div>
    </Tabs>
  );
}
