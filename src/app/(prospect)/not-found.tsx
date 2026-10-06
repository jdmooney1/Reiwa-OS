/**
 * The ONE answer to every link that does not open: a wrong token, an expired share, a revoked
 * one, a memo that is no longer final. It says nothing about which, so a wrong guess learns
 * nothing from it.
 */
export default function ProspectNotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-sm text-ink-muted">This link is not available.</p>
      <p className="mt-2 text-xs text-ink-faint">If you were expecting a document, please contact the person at Reiwa Capital who sent it to you.</p>
    </main>
  );
}
