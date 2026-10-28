import type { SitePublicationStatus } from "@tomokichi/contracts";
import { formatDateTime } from "./labels";

export interface SeriesSiteState {
  tone: "ok" | "accent" | "warn" | "danger" | "neutral";
  text: string;
  /** Whether "サイトに反映する" should be offered. */
  canPublish: boolean;
}

/**
 * Where a saved series stands on the public site. Saving writes the database
 * only; the pages change once a build requested after that save is deployed.
 * The latest request's time is what counts — a build that was already running
 * when the series was saved read the database before the change.
 */
export function seriesSiteState(
  updatedAt: string | null,
  site: SitePublicationStatus | undefined,
  dirty: boolean,
): SeriesSiteState {
  if (dirty)
    return {
      tone: "neutral",
      text: "未保存の変更があります。保存するとDBに記録されます。",
      canPublish: false,
    };
  if (!site) return { tone: "neutral", text: "確認中…", canPublish: false };
  if (site.state === "unconfigured")
    return {
      tone: "danger",
      text: "自動反映が未設定のため、サイトには反映されません。",
      canPublish: false,
    };
  const requestedAfterSave =
    updatedAt !== null && site.requestedAt !== null && site.requestedAt >= updatedAt;
  if (!requestedAfterSave)
    return updatedAt === null
      ? {
          tone: "neutral",
          text: "保存記録がないため、反映状況は次の保存から表示します。",
          canPublish: true,
        }
      : { tone: "warn", text: "DBに保存済み。サイトへの反映待ちです。", canPublish: true };
  if (site.state === "deployed")
    return {
      tone: "ok",
      text: `サイトに反映済み${site.deployedAt ? `（${formatDateTime(site.deployedAt)}）` : ""}`,
      canPublish: false,
    };
  if (site.state === "failed")
    return { tone: "danger", text: "サイトへの反映に失敗しました。", canPublish: true };
  return { tone: "accent", text: "サイトに反映しています。", canPublish: false };
}
