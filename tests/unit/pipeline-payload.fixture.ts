// A full Opportunity as the shared query returns it, location fields included.
import type { Opportunity } from "@/lib/data/opportunity-types";

export function row(): Opportunity {
  return {
    opportunityId: "o1", orgId: "org", propertyId: "p1", name: "24-26 Spring Street", market: "London",
    submarket: "Paddington", assetType: "office", strategy: "core", stage: "new", status: "active",
    documentStage: 0,
    currency: "GBP", targetPrice: null, niy: null, reversionaryYield: null, passingRent: null, erv: null,
    capexBudget: null, targetIrr: null, equityMultiple: null, probability: null, source: null,
    sourceType: "other", sourceContactName: null, sourceContactEmail: null, sourcedAt: null,
    referralNote: null, brokerName: "Knight Frank", vendorName: null, priority: "medium",
    triageStatus: "live", triagePriority: "P1", triageNote: "Strong income", ownerUserId: null,
    ownerName: null, nextMilestone: null, nextMilestoneDate: null, lastMaterialUpdateAt: null,
    sizeSqft: null, sizeSqm: null, summary: null, investorOverview: null, address: "24-26 Spring Street", city: "London",
    country: "United Kingdom",
    latitude: 51.5158, longitude: -0.1755, geocodeStatus: "ok",
    formattedAddress: "24-26 Spring St, London W2 1JA, UK",
    geocodedAt: "2026-09-29T10:00:00.000Z", hasStreetView: true,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", archivedAt: null, assetId: null,
  };
}
