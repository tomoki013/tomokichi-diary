import type { ArticleSummaryDto, SitePublicationStatus } from "@tomokichi/contracts";
import { formatDateTime } from "./labels";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";
export interface StateLine {
  label: string;
  tone: Tone;
  text: string;
}

type Article = Pick<
  ArticleSummaryDto,
  "status" | "isLive" | "hasUnpublishedChanges" | "publishedAt" | "scheduledAt" | "updatedAt"
>;

/**
 * The one answer to "is this article public?", used by the list, the
 * dashboard, the editor header and the publish panel alike so they never
 * disagree. `hasUnpublishedChanges` is true for every draft (nothing is
 * published yet), so it only means "changes waiting" on a live article.
 */
export type Phase = "draft" | "withdrawn" | "scheduled" | "live" | "changed" | "archived";

export const phases: Record<Phase, { label: string; tone: Tone }> = {
  draft: { label: "下書き", tone: "neutral" },
  withdrawn: { label: "非公開", tone: "neutral" },
  scheduled: { label: "予約", tone: "accent" },
  live: { label: "公開中", tone: "ok" },
  changed: { label: "公開中・変更未公開", tone: "warn" },
  archived: { label: "アーカイブ", tone: "neutral" },
};

export function phaseOf(
  article: Pick<Article, "status" | "isLive" | "hasUnpublishedChanges" | "publishedAt">,
): Phase {
  if (article.status === "archived") return "archived";
  if (article.isLive) return article.hasUnpublishedChanges ? "changed" : "live";
  // Published with a future date waits like a scheduled one.
  if (article.status === "scheduled" || article.status === "published") return "scheduled";
  return article.publishedAt ? "withdrawn" : "draft";
}

/** A filter for one or more phases, for lists and counts. */
export const inPhase =
  (...wanted: Phase[]) =>
  (article: Parameters<typeof phaseOf>[0]): boolean =>
    wanted.includes(phaseOf(article));

/**
 * Where this one article stands, from draft to the public site. The site's
 * own publication is shared by every article, so it only speaks for this one
 * when the article is live and nothing newer than its publish is pending.
 */
export function articleState(
  article: Article,
  unsaved: boolean,
  site: SitePublicationStatus | undefined,
): StateLine[] {
  const phase = phaseOf(article);
  const label = "この記事";
  const lines: StateLine[] = [
    {
      label,
      tone: phases[phase].tone,
      text: {
        archived: "アーカイブ済み。サイトには表示されません。",
        scheduled: `予約中。${formatDateTime(article.scheduledAt ?? article.publishedAt)} に公開されます。`,
        live: article.publishedAt
          ? `公開中（初回公開 ${formatDateTime(article.publishedAt)}）`
          : "公開中",
        changed: "公開中。保存した変更はまだ公開していません。「変更を公開」で反映します。",
        withdrawn: "非公開（以前は公開していました）。サイトには表示されません。",
        draft: "下書き。まだ一度も公開していません。",
      }[phase],
    },
  ];
  if (unsaved) lines.push({ label: "編集", tone: "warn", text: "未保存の変更があります。" });
  if (article.isLive) lines.push(siteLine(article, site));
  return lines;
}

function siteLine(article: Article, site: SitePublicationStatus | undefined): StateLine {
  const label = "サイト";
  if (!site) return { label, tone: "neutral", text: "確認中…" };
  // With saved edits waiting, `updatedAt` is the save, not the publish:
  // the site shows the earlier published version.
  if (article.hasUnpublishedChanges)
    return { label, tone: "neutral", text: "前回公開した版を表示しています。" };
  const since = article.updatedAt;
  // A deploy after this article's publish carries it, whatever happened since.
  if (site.deployedAt && site.deployedAt >= since)
    return { label, tone: "ok", text: `反映済み（${formatDateTime(site.deployedAt)}）` };
  if (site.state === "unconfigured")
    return { label, tone: "danger", text: "自動反映が未設定のため、サイトには反映されません。" };
  if (site.state === "failed")
    return { label, tone: "danger", text: "サイトへの反映に失敗しました。下で再試行できます。" };
  if (site.state === "queued" || site.state === "building")
    return { label, tone: "accent", text: "サイトに反映しています。" };
  if (!site.requestId) return { label, tone: "neutral", text: "サイトへの反映記録はありません。" };
  return { label, tone: "warn", text: "サイトへの反映待ちです。" };
}
