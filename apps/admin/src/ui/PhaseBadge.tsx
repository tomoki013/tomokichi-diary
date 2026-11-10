import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { phaseOf, phases } from "../lib/article-state";
import { Badge } from "./parts";

export function PhaseBadge({ article }: { article: Parameters<typeof phaseOf>[0] }) {
  const phase = phases[phaseOf(article)];
  return <Badge tone={phase.tone}>{phase.label}</Badge>;
}

export type { ArticleSummaryDto };
