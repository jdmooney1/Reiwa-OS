// The investor route group. Each page paints its own frame: the access flow
// uses the narrow dark AccessFrame, the authenticated portal uses PortalShell.
// Nothing here is shared with the internal (app) shell.
export const dynamic = "force-dynamic";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
