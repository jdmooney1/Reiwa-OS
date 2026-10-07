// Shared between import-capital-pipeline-test-orgs.ts and
// remove-capital-pipeline-import.ts — kept in its own module (no side
// effects, nothing that runs on import) so the removal script can reuse the
// exact tag format without either script executing the other's main().
export const TAG_PREFIX = "[test-import:capital-pipeline:";
