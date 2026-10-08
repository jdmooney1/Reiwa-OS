import type { Metadata } from "next";
import { DM_Sans, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// One family across the whole system — the interface face and the editorial
// face are the same. It is also the face the investor OTP email is set in, so
// the email and the product finally read as one company.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Added for the deal document system (docs/24 §D). Before this, the only font
// loaded anywhere was DM Sans (latin-only); every Japanese render — the memo
// translation Teaser (docs/22), the Japanese Language Summary print view —
// fell through to whatever CJK font the viewer's OS happened to have
// installed, unverified. `--font-jp` is a named fallback, not a replacement:
// DM Sans still leads for Latin text, Noto Sans JP only takes over for
// glyphs DM Sans has none of. Browser rendering only — the Session 6
// headless-Chromium PDF pipeline must embed this font directly in its own
// render context and cannot rely on next/font's browser-side loading.
const notoSansJP = Noto_Sans_JP({
  // next/font/google's subset list for this font is latin/latin-ext/cyrillic/
  // vietnamese only — there is no separate "japanese" subset to request. The
  // Japanese glyph coverage is not subset-gated; it is simply what this font
  // is. "latin" here only affects which additional Latin-range variant is
  // fetched alongside it, not whether CJK glyphs are included.
  subsets: ["latin"],
  variable: "--font-jp",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Reiwa OS — Deal Intelligence",
  description:
    "Private real estate deal intelligence platform for Reiwa Capital.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${notoSansJP.variable}`}>
      <body>{children}</body>
    </html>
  );
}
