import { ReiwaLockup } from "@/components/brand/reiwa-lockup";

// The frame for the unauthenticated access flow (P3): the invitation landing
// page and the one-time-code screen. Deliberately shares nothing with the
// internal (app) shell — no sidebar, no internal navigation.
//
// Cream, not a dark field. These two screens are the first thing an investor
// sees after the invitation email, and the email is cream with the lockup on it;
// a navy screen with a gold button made the two read as different companies.
// The mark carries the identity here, so nothing else needs to.
export function AccessFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <main className="flex flex-1 items-center justify-center px-6 pb-[10vh] pt-12">
        <div className="w-full max-w-lg">
          <ReiwaLockup size="entry" className="mb-12" />
          {children}
        </div>
      </main>
      <footer className="px-6 pb-10">
        <p className="mx-auto max-w-lg text-2xs leading-relaxed text-ink-faint">
          Private &amp; confidential. Access is by invitation of Reiwa Capital only.
        </p>
      </footer>
    </div>
  );
}
