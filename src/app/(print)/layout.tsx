import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * A bare shell for documents meant to be printed: no sidebar, no workspace chrome.
 * It is NOT public. The same session check as the application applies, and the
 * page beneath reads the memo under the caller's own row-level security.
 *
 * The print rules live here, in one place: A4, modest margins, no background
 * colour, and sections that are not split mid-block where a block can avoid it.
 * There is no PDF library; the browser's own "Save as PDF" is the export.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return (
    <div className="min-h-screen bg-surface-sunken print:bg-white">
      <style>{`
        @page { size: A4; margin: 16mm 15mm 18mm 15mm; }
        @media print {
          html, body { background: #fff !important; }
          .memo-block { break-inside: avoid; }
          .memo-heading { break-after: avoid; }
          .memo-sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; max-width: none !important; padding: 0 !important; }
        }
      `}</style>
      {children}
    </div>
  );
}
