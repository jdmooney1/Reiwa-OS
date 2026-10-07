import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { getPublishReview } from "@/lib/data/publish-review";
import { PublishReviewForm } from "@/components/admin/publish-review-form";

export const dynamic = "force-dynamic";

/**
 * The only way to publish. Reads what is about to change, in words, and asks for
 * a typed sentence built from it. The server action re-reads and re-checks all of
 * this, so this page is the explanation and the action is the enforcement.
 */
export default async function PublishReviewPage({
  params,
}: {
  params: { publicationId: string; versionId: string };
}) {
  const auth = await requireAdminAuth();
  const review = await getPublishReview(toDbSession(auth), params.versionId);
  if (!review || review.publicationId !== params.publicationId) notFound();

  const back = `/admin/publications/${review.publicationId}`;

  return (
    <div className="min-h-full">
      <div className="border-b border-line bg-surface-card px-8 py-6 text-ink">
        <Link href={back} className="mb-2 inline-flex items-center gap-1 text-2xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Back to the publication
        </Link>
        <div className="eyebrow mb-1">Review before publishing</div>
        <h1 className="text-2xl">{review.title}</h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-faint">
          {review.liveVersionNumber !== null
            ? `Version ${review.versionNumber} will replace version ${review.liveVersionNumber}, which investors see now.`
            : `Version ${review.versionNumber} will be the first version investors see.`}
        </p>
      </div>
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        {review.status !== "in_review" ? (
          <p className="border-l-2 border-caution pl-3 text-sm text-ink-muted" data-testid="not-in-review">
            Version {review.versionNumber} is {review.status.replace("_", " ")}, not in review, so it cannot be
            published from here. Submit a draft for review first.
          </p>
        ) : (
          <PublishReviewForm review={review} backHref={back} />
        )}
      </div>
    </div>
  );
}
