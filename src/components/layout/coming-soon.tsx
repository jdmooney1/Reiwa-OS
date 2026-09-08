import { PageHeader } from "./page-header";

export function ComingSoon({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-ink-muted">Coming soon</div>
          <div className="mt-1 text-xs text-ink-faint">
            This module is on the Reiwa OS roadmap.
          </div>
        </div>
      </div>
    </div>
  );
}
