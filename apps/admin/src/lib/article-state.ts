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
 * Where this one article stands, from draft to the public site. The site's
 * own publication is shared by every article, so it only speaks for this one
 * when the article is live and nothing newer than its publish is pending.
 */
export function articleState(
  article: Article,
  unsaved: boolean,
  site: SitePublicationStatus | undefined,
): StateLine[] {
  const lines: StateLine[] = [];

  if (article.status === "archived") {
    lines.push({
      label: "この記事",
      tone: "neutral",
      text: "アーカイブ済み。サイトには表示されません。",
    });
  } else if (article.status === "scheduled") {
    lines.push({
      label: "この記事",
      tone: "accent",
      text: `予約中。${formatDateTime(article.scheduledAt)} に公開されます。`,
    });
  } else if (article.isLive) {
    lines.push({
      label: "この記事",
      tone: "ok",
      text: article.publishedAt
        ? `公開中（初回公開 ${formatDateTime(article.publishedAt)}）`
        : "公開中",
    });
  } else {
    lines.push({
      label: "この記事",
      tone: "neutral",
      text: article.publishedAt
        ? "下書き（非公開に戻しています）。サイトには表示されません。"
        : "下書き。まだ一度も公開していません。",
    });
  }

  if (unsaved) {
    lines.push({ label: "編集", tone: "warn", text: "未保存の変更があります。" });
  }

  if (article.isLive) {
    lines.push(
      article.hasUnpublishedChanges
        ? {
            label: "公開版",
            tone: "warn",
            text: "保存済みの変更がまだ公開されていません。「変更を公開」で反映します。",
          }
        : { label: "公開版", tone: "ok", text: "保存済みの最新版が公開されています。" },
    );
    lines.push(siteLine(article, site));
  }

  return lines;
}

function siteLine(article: Article, site: SitePublicationStatus | undefined): StateLine {
  const label = "サイト";
  if (!site) return { label, tone: "neutral", text: "確認中…" };
  if (site.state === "unconfigured")
    return { label, tone: "danger", text: "自動反映が未設定のため、サイトには反映されません。" };
  if (site.state === "failed")
    return { label, tone: "danger", text: "サイトへの反映に失敗しました。下で再試行できます。" };
  // With saved edits waiting, `updatedAt` is the save, not the publish:
  // the site shows the earlier published version.
  if (article.hasUnpublishedChanges)
    return { label, tone: "ok", text: "公開版が表示されています（変更は未反映）。" };
  const since = article.updatedAt;
  if ((site.state === "queued" || site.state === "building") && (site.requestedAt ?? "") >= since)
    return { label, tone: "accent", text: "この記事の公開をサイトに反映しています。" };
  if (!site.requestId) return { label, tone: "neutral", text: "サイトへの反映記録はありません。" };
  if (site.deployedAt && site.deployedAt >= since)
    return { label, tone: "ok", text: `反映済み（${formatDateTime(site.deployedAt)}）` };
  return { label, tone: "warn", text: "サイトへの反映待ちです。" };
}
