// Portal constants shared by server and client code.
//
// This module deliberately imports nothing: it is pulled into the browser
// bundle by the compare store, so anything it touched would be dragged in with
// it — which is how the server data layer (and `pg`) would end up client-side.
// Keep it free of imports.

/** The most opportunities a comparison may hold. Enforced on the server too. */
export const COMPARE_LIMIT = 3;
