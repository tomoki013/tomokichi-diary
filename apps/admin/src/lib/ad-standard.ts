import type {
  AdExperiment,
  ArticleDetailDto,
  ArticleMonetization,
  ArticleSummaryDto,
  MonetizationOverviewDto,
  MonetizationPlacement,
} from "@tomokichi/contracts";
import { bodyAdPlacementProblem } from "@tomokichi/contracts";
import { api } from "./api";
import { suggestAdParagraph } from "./ad-rollout";
import { draftFrom } from "./draft";

/**
 * The one ad layout every article should have, decided here so neither the
 * editor nor the bulk tool asks the author to pick positions, statuses or
 * units by hand:
 *
 * - AdSense on, one ad at the article end, one ad in the body.
 * - The body ad reuses a marker already in the text (the A/B test's B slot
 *   first), otherwise goes after the paragraph `suggestAdParagraph` finds.
 * - Affiliate slots are left exactly as they are; the mode follows from them.
 * - A running placement test ends: its B arm (end + body) is the standard.
 */
export const DEFAULT_AD_UNIT = "7152502134";
export const BODY_AD_KEY = "body-ad";
const END_KEY = "article-end";

export type AdLayout = "standard" | "end-only" | "none";

export const adLayoutLabels: Record<AdLayout, string> = {
  standard: "標準（末尾＋本文中）",
  "end-only": "末尾のみ",
  none: "広告なし",
};

const markerPattern = /^\{\{monetization:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}[ \t]*$/gm;
export function markerKeys(body: string): string[] {
  return [...body.matchAll(markerPattern)].map((m) => m[1]!);
}

/** The publish check's own placement rule (bodyAdPlacementProblem), so a plan never fails on save. */
export function bodyAdFits(body: string, key: string): boolean {
  const marker = `{{monetization:${key}}}`;
  const at = body.indexOf(marker);
  if (at < 0) return false;
  return bodyAdPlacementProblem(body.slice(0, at), body.slice(at + marker.length)) === null;
}

const isAd = (p: MonetizationPlacement) => p.kind === "adsense";
const ready = (p: MonetizationPlacement) => p.status === "ready";

/** What readers get from this configuration, ignoring a running test. */
export function adLayoutOf(config: ArticleMonetization): AdLayout {
  if (!config.adsEnabled || !["ads", "hybrid"].includes(config.mode)) return "none";
  return config.placements.some((p) => isAd(p) && ready(p) && p.position === "marker")
    ? "standard"
    : "end-only";
}

/** `none` / `ads` / `affiliate` / `hybrid` is never chosen by hand: it follows from the slots. */
export function modeFor(adsOn: boolean, placements: readonly MonetizationPlacement[]) {
  const affiliate = placements.some((p) => p.kind === "affiliate" && ready(p));
  return adsOn ? (affiliate ? "hybrid" : "ads") : affiliate ? "affiliate" : "none";
}

export function removeMarker(body: string, key: string): string {
  return body
    .replace(new RegExp(`\\n*^\\{\\{monetization:${key}\\}\\}[ \\t]*$\\n*`, "m"), "\n\n")
    .replace(/^\n+/, "");
}

export function insertMarker(body: string, offset: number, key: string): string {
  return `${body.slice(0, offset).trimEnd()}\n\n{{monetization:${key}}}\n\n${body.slice(offset).trimStart()}`;
}

export interface StandardPlan {
  config: ArticleMonetization;
  body: string;
  /** The running test to end first, if any. */
  stopExperiment: string | null;
  /** What changes, in the author's words. Empty when already standard. */
  changes: string[];
}

/**
 * Applies a layout to one article's configuration and body. Pure: the caller
 * saves the result. Returns a reason instead when the body has no place that
 * passes the placement rule and the author has to choose one.
 */
export function applyLayout(
  layout: AdLayout,
  config: ArticleMonetization,
  body: string,
  experiment: AdExperiment | null,
): StandardPlan | { error: string } {
  const changes: string[] = [];
  const running = experiment?.status === "running" ? experiment : null;
  if (running) changes.push("A/Bテストを終了");
  const affiliates = config.placements.filter((p) => p.kind === "affiliate");
  const ads = config.placements.filter(isAd);
  const unit = ads.find((p) => p.position === "article_end")?.adUnit ?? DEFAULT_AD_UNIT;
  const present = new Set(markerKeys(body));
  let nextBody = body;
  const placements: MonetizationPlacement[] = [];
  const adsOn = layout !== "none";
  if (adsOn) {
    const end = ads.find((p) => p.position === "article_end");
    if (!end || !ready(end) || !config.adsEnabled || !["ads", "hybrid"].includes(config.mode))
      changes.push("記事末尾の広告を表示");
    placements.push({
      key: end?.key ?? END_KEY,
      kind: "adsense",
      position: "article_end",
      status: "ready",
      adUnit: unit,
      offerId: null,
    });
  }
  // The body ad: the test's B slot, then the one already showing, then any.
  const markers = ads.filter(
    (p) => p.position === "marker" && present.has(p.key) && bodyAdFits(body, p.key),
  );
  const keep =
    layout === "standard"
      ? (markers.find((p) => p.key === running?.markerKey) ??
        markers.find(ready) ??
        markers[0] ??
        null)
      : null;
  for (const p of ads.filter((a) => a.position === "marker" && a !== keep)) {
    if (present.has(p.key)) nextBody = removeMarker(nextBody, p.key);
    if (ready(p) || p.key === running?.markerKey) changes.push("本文中の広告を外す");
  }
  if (layout === "standard") {
    if (keep) {
      if (!ready(keep) || running) changes.push("本文中の広告を表示");
      placements.push({ ...keep, status: "ready", adUnit: keep.adUnit || unit });
    } else {
      const spot = suggestAdParagraph(nextBody);
      if (!spot)
        return { error: "本文中の広告を置ける段落がありません。記事編集で位置を選んでください" };
      const key = present.has(BODY_AD_KEY) ? `${BODY_AD_KEY}-2` : BODY_AD_KEY;
      nextBody = insertMarker(nextBody, spot.offset, key);
      changes.push(`本文の約${Math.round(spot.fraction * 100)}%に広告を追加`);
      placements.push({
        key,
        kind: "adsense",
        position: "marker",
        status: "ready",
        adUnit: unit,
        offerId: null,
      });
    }
  }
  if (!adsOn && config.adsEnabled && ["ads", "hybrid"].includes(config.mode))
    changes.push("広告を表示しない");
  placements.push(...affiliates);
  return {
    config: {
      ...config,
      mode: modeFor(adsOn, placements),
      adsEnabled: adsOn,
      maxAds: 1,
      experimentId: null,
      placements,
    },
    body: nextBody,
    stopExperiment: running?.id ?? null,
    changes: [...new Set(changes)],
  };
}

export type AdAuditKind =
  | "standard"
  | "end-only"
  | "missing-body"
  | "testing"
  | "test-ended"
  | "end-stopped"
  | "off"
  | "unpublished"
  | "not-live";

export const adAuditLabels: Record<
  AdAuditKind,
  { label: string; tone: "ok" | "warn" | "neutral" | "accent" }
> = {
  standard: { label: "標準どおり", tone: "ok" },
  "end-only": { label: "末尾のみ", tone: "neutral" },
  "missing-body": { label: "本文中の広告なし", tone: "warn" },
  testing: { label: "A/Bテスト中", tone: "accent" },
  "test-ended": { label: "テスト終了・本文中なし", tone: "warn" },
  "end-stopped": { label: "末尾の広告が停止", tone: "warn" },
  off: { label: "広告オフ", tone: "neutral" },
  unpublished: { label: "変更未公開", tone: "neutral" },
  "not-live": { label: "未公開の記事", tone: "neutral" },
};

/**
 * Kinds the bulk tool selects up front. "末尾のみ" was chosen on purpose (or
 * the body is too short); a running test is selected only once it has run
 * long enough to read (see `AdAudit.startedAt`).
 */
export const autoFixKinds: readonly AdAuditKind[] = [
  "missing-body",
  "end-stopped",
  "test-ended",
  "off",
];

/**
 * Where the bulk tool takes each kind. Articles with ads switched off get
 * only the end ad, which is also where short articles land when no body
 * paragraph qualifies.
 */
export function targetFor(kind: AdAuditKind): Exclude<AdLayout, "none"> {
  return kind === "off" ? "end-only" : "standard";
}

export interface AdAudit {
  article: ArticleSummaryDto;
  kind: AdAuditKind;
  /** Whether the bulk tool can publish a fix for it now. */
  fixable: boolean;
  /** For a running test: when it started. */
  startedAt?: string | null;
}

export const blankConfig = (): ArticleMonetization => ({
  mode: "ads",
  adsEnabled: true,
  maxAds: 1,
  experimentId: null,
  placements: [],
  updatedAt: null,
});

/** From the list data alone, so the whole site is classified without reading every body. */
export function auditArticles(
  articles: readonly ArticleSummaryDto[],
  overview: MonetizationOverviewDto,
): AdAudit[] {
  return articles
    .filter((a) => a.kind === "article" && a.status !== "archived")
    .map((article) => {
      const own = overview.articles.find((a) => a.articleId === article.id)?.config;
      const config = own ?? blankConfig();
      const testing = overview.experiments.find(
        (e) => e.articleId === article.id && e.status === "running",
      );
      // A stopped test leaves its article on the end ad until it is detached.
      const ended =
        config.experimentId &&
        overview.experiments.some((e) => e.id === config.experimentId && e.status !== "running");
      const ads = config.placements.filter((p) => isAd(p) && ready(p));
      const kind: AdAuditKind = !article.isLive
        ? "not-live"
        : article.hasUnpublishedChanges
          ? "unpublished"
          : testing
            ? "testing"
            : ended
              ? "test-ended"
              : adLayoutOf(config) === "none"
                ? "off"
                : !ads.some((p) => p.position === "marker")
                  ? own
                    ? "end-only"
                    : "missing-body"
                  : config.placements.some(
                        (p) => isAd(p) && p.position === "article_end" && !ready(p),
                      )
                    ? "end-stopped"
                    : "standard";
      return {
        article,
        kind,
        fixable: !["standard", "unpublished", "not-live"].includes(kind),
        ...(testing ? { startedAt: testing.startedAt } : {}),
      };
    });
}

type Client = Pick<
  typeof api,
  | "getArticle"
  | "articleMonetization"
  | "saveDraft"
  | "saveArticleMonetization"
  | "controlAdExperiment"
>;

/**
 * Brings one live article to a layout and leaves it ready to publish. A body
 * with no qualifying paragraph gets the end ad only. Refuses when the article
 * moved since the list was read, so it never publishes someone's unrelated
 * edits along with the ad change.
 */
export async function prepareLayout(
  summary: ArticleSummaryDto,
  overview: MonetizationOverviewDto,
  target: Exclude<AdLayout, "none"> = "standard",
  client: Client = api,
): Promise<{ article: ArticleDetailDto; changes: string[] }> {
  const article = await client.getArticle(summary.id);
  if (!article.isLive || article.hasUnpublishedChanges || !article.currentRevision)
    throw new Error("公開中の最新版ではありません。記事編集で確認してください");
  const { draft } = await client.articleMonetization(article.id);
  const experiment =
    overview.experiments.find((e) => e.articleId === article.id && e.status === "running") ?? null;
  const body = article.currentRevision.bodyMarkdown;
  let plan = applyLayout(target, draft, body, experiment);
  if ("error" in plan) {
    plan = applyLayout("end-only", draft, body, experiment);
    if ("error" in plan) throw new Error(plan.error);
    // An unconfigured article already shows the end ad; record the choice once.
    const rest = plan.changes.filter((c) => c !== "記事末尾の広告を表示");
    plan.changes =
      rest.length || !draft.updatedAt ? [...rest, "本文に置ける段落がないため末尾のみ"] : [];
  }
  if (plan.changes.length === 0) return { article, changes: [] };
  // Body, then configuration, then the test: a failure part-way leaves an
  // unpublished draft to finish in the editor, never a half-ended test.
  if (plan.body !== article.currentRevision.bodyMarkdown)
    await client.saveDraft(article.id, {
      ...draftFrom(article),
      bodyMarkdown: plan.body,
      changeSummary: "広告配置を揃える（本文内容は維持）",
    });
  await client.saveArticleMonetization(article.id, plan.config);
  if (plan.stopExperiment) await client.controlAdExperiment(plan.stopExperiment, "stop");
  return { article: await client.getArticle(article.id), changes: plan.changes };
}
