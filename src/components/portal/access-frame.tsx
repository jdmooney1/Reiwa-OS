// The narrow, dark frame for the unauthenticated access flow (P3): the
// invitation landing page and the one-time-code screen. Deliberately shares
// nothing with the internal (app) shell — no sidebar, no internal navigation.
export function AccessFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-navy">
      <header className="border-b border-line-dark px-8 py-5">
        <div className="mx-auto flex w-full max-w-3xl items-baseline justify-between">
          <div className="font-serif text-lg tracking-wide text-surface">
            REIWA<span className="text-gold"> CAPITAL</span>
          </div>
          <div className="eyebrow-light">Investment Portal</div>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-6 py-14">
        <div className="w-full max-w-lg">{children}</div>
      </main>
      {/* surface/30 measured 2.6:1 against the navy — below the 4.5:1 needed
          for small text. surface/55 keeps the same recessive weight at 5.5:1. */}
      <footer className="px-8 py-5 text-center text-2xs text-surface/60">
        Private &amp; confidential. Access is by invitation of Reiwa Capital only.
      </footer>
    </div>
  );
}
