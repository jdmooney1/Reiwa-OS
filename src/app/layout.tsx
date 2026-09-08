import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

// One family across the whole system — the interface face and the editorial
// face are the same. It is also the face the investor OTP email is set in, so
// the email and the product finally read as one company.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
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
    <html lang="en" className={dmSans.variable}>
      <body>{children}</body>
    </html>
  );
}
