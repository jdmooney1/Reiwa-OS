import type { Metadata } from "next";

// The investor route group. Each page paints its own frame: the access flow
// uses AccessFrame, the authenticated portal uses PortalShell. Nothing here is
// shared with the internal (app) shell.
//
// The title is overridden for the whole group because the root layout names the
// internal product, and "Reiwa OS" must never reach an investor — including in
// the browser tab, the history entry, or a bookmark.
export const metadata: Metadata = {
  title: "Reiwa Capital Investment Portal",
  description: "Private investment portal for authorised Reiwa Capital investors.",
};

export const dynamic = "force-dynamic";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
