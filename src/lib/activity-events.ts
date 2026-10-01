// The investor activity vocabulary, shared by server and client code.
//
// This module deliberately imports nothing. The activity filter bar is a client
// component and needs these values, so anything imported here would be pulled
// into the browser bundle with them — which is how the server data layer (and
// `pg`) would end up client-side. Keep it free of imports.

/** Exactly the event types `investor_activity_events` accepts (migrations 0005 and 0021). */
export type ActivityEventType =
  | "login" | "opportunity_viewed" | "saved" | "unsaved" | "compared"
  | "document_viewed" | "document_downloaded" | "information_requested"
  | "photo_viewed";

/** The event types worth showing an operator, in reporting order. */
export const REPORTABLE_EVENTS: ActivityEventType[] = [
  "login", "opportunity_viewed", "saved", "unsaved", "compared",
  "document_viewed", "document_downloaded", "information_requested",
  "photo_viewed",
];
