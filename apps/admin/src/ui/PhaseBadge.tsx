import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { phaseOf, phases } from "../lib/article-state";
import { formatDateTime } from "../lib/labels";
import { Badge } from "./parts";

/** The article's publication state, worded the same on every screen. */
export function PhaseBadge({
  article,
}: {
  article: Pick<
    ArticleSummaryDto,
    "status" | "isLive" | "hasUnpublishedChanges" | "publishedAt" | "scheduledAt"
  >;
}) {
  const phase = phaseOf(article);
  return (
    <span className="phase">
      <Badge tone={phases[phase].tone}>{phases[phase].label}</Badge>
      {phase === "scheduled" && (
        <span className="muted small">
          {formatDateTime(article.scheduledAt ?? article.publishedAt)}
        </span>
      )}
    </span>
  );
}
