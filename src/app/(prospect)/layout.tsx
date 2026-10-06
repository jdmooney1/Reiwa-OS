import type { Metadata } from "next";

// The prospect route group: a fourth surface, beside (app), (portal) and (print), sharing
// nothing with them. There is NO session here, of any kind: the link's token is the
// credential, and the page that checks it reads two tables and nothing else.
//
// The title is overridden because the root layout names the internal product, and
// "Reiwa OS" must never reach a prospect. Search engines and referrers are told to leave
// it alone twice over: here, and in the response headers set in next.config.mjs.
export const metadata: Metadata = {
  title: "Reiwa Capital",
  description: "Confidential. Prepared for the named recipient.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default function ProspectLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-surface-sunken">{children}</div>;
}
