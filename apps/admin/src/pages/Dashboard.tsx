import { useDeferredValue, useMemo, useState } from "react";
import type {
  AnalyticsDashboardDto,
  AnalyticsReportDto,
  DashboardIdeaDto,
  DashboardIdeaInput,
  DashboardTaskDto,
  DashboardTaskInput,
  ArticleReadingDto,
  ArticleSummaryDto,
  CollectionAdminDto,
  MonetizationOverviewDto,
} from "@tomokichi/contracts";
import { api } from "../lib/api";
import { reviewReasons } from "../lib/analytics-review";
import { adAuditLabels, auditArticles, adLayoutOf } from "../lib/ad-standard";
import { inPhase as is, phaseOf, phases } from "../lib/article-state";
import { formatDateTime, formatRelative, ticketStatusLabels } from "../lib/labels";
import { href } from "../lib/route";
import { useResource, useTitle } from "../ui/hooks";
import { PhaseBadge } from "../ui/PhaseBadge";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";
import { useToast } from "../ui/toast";
import "./dashboard.css";

type Range = { start: string; end: string };
type RangePreset = "7" | "28" | "90" | "week" | "month" | "custom";
const emptyArticleList: readonly ArticleSummaryDto[] = [];
const dateInTokyo = (date = new Date()) =>
  date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const shiftDate = (date: string, offset: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const daysBetween = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
function recentRange(days: number): Range {
  const end = shiftDate(dateInTokyo(), -1);
  return { start: shiftDate(end, 1 - days), end };
}
function completedWeek(): Range {
  const today = dateInTokyo();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const currentMonday = shiftDate(today, mondayOffset);
  const end = shiftDate(currentMonday, -1);
  return { start: shiftDate(end, -6), end };
}
function completedMonth(): Range {
  const today = dateInTokyo();
  const firstOfCurrent = `${today.slice(0, 7)}-01`;
  const end = shiftDate(firstOfCurrent, -1);
  return { start: `${end.slice(0, 7)}-01`, end };
}
function initialRange(): Range {
  return recentRange(28);
}
const number = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "—"
    : value.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const signed = (value: number, digits = 1) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
const sourceMetrics = (sources: AnalyticsDashboardDto["current"] | undefined, source: string) =>
  sources?.find((item) => item.source === source)?.metrics ?? {};
const sourceCoverage = (sources: AnalyticsDashboardDto["current"] | undefined, source: string) =>
  sources?.find((item) => item.source === source);
const measuredRate = (
  rows: readonly ArticleReadingDto[] | undefined,
  rateKey:
    | "body75Rate"
    | "body75RatePrevious"
    | "bodyEndRate"
    | "bodyEndRatePrevious"
    | "nextArticleRate"
    | "nextArticleRatePrevious",
  viewsKey: "measuredViews" | "measuredViewsPrevious",
) => {
  const totals = (rows ?? []).reduce(
    (sum, row) => {
      const rate = row[rateKey];
      const views = row[viewsKey] ?? 0;
      if (rate == null || views <= 0) return sum;
      sum.views += views;
      sum.events += rate * views;
      return sum;
    },
    { views: 0, events: 0 },
  );
  return totals.views ? totals.events / totals.views : null;
};
const dateLabel = (range: Range) =>
  `${range.start}〜${range.end}（${daysBetween(range.start, range.end)}日）`;
const titleFor = (article: ArticleSummaryDto) => article.title || article.slug;
const phaseOfLabel = (article: ArticleSummaryDto) => phases[phaseOf(article)].label;
const isChagee = (article: ArticleSummaryDto) =>
  /\bchagee\b|チャージー|霸王茶姬/i.test(`${article.title} ${article.slug} ${article.path ?? ""}`);

function difference(
  current: number | null | undefined,
  previous: number | null | undefined,
  kind: "count" | "rate" | "position" = "count",
) {
  if (current == null || previous == null) return "前期間と比較できません";
  const delta = current - previous;
  if (kind === "rate") {
    const pp = signed(delta * 100, 2);
    const relative = previous !== 0 ? `（${signed((delta / Math.abs(previous)) * 100, 0)}%）` : "";
    return `${pp}ポイント${relative}`;
  }
  if (kind === "position")
    return `${delta < 0 ? "改善" : delta > 0 ? "低下" : "±0"} ${Math.abs(delta).toFixed(1)}`;
  if (previous === 0) return current === 0 ? "±0" : `+${number(current)}`;
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${number(Math.abs(delta))}（${signed((delta / Math.abs(previous)) * 100, 0)}%）`;
}

function MetricCard({
  label,
  current,
  previous,
  format = number,
  changeKind = "count",
  source,
  data,
  detail,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  format?: (value: number | null | undefined) => string;
  changeKind?: "count" | "rate" | "position";
  source: string;
  data: AnalyticsDashboardDto;
  detail?: string;
}) {
  const coverage = sourceCoverage(data.current, source);
  const previousCoverage = sourceCoverage(data.previous, source);
  const delta = current == null || previous == null ? null : current - previous;
  const better = changeKind === "position" ? (delta ?? 0) < 0 : (delta ?? 0) > 0;
  return (
    <article className="dashboard-kpi">
      <h2>{label}</h2>
      <strong>{format(current)}</strong>
      <div className="dashboard-kpi__previous">
        前期間 {format(previous)}
        {delta !== null && (
          <span className={delta === 0 ? "" : better ? "is-better" : "is-worse"}>
            {difference(current, previous, changeKind)}
          </span>
        )}
      </div>
      <small>
        {detail ??
          (coverage
            ? `${coverage.coveredDays}/${coverage.expectedDays}日取得${coverage.provisional ? " · 暫定値あり" : ""}`
            : "記事表示の計測値")}
        {coverage && previousCoverage && coverage.coveredDays !== previousCoverage.coveredDays
          ? " · 取得日数が異なるため比較は参考値"
          : ""}
      </small>
    </article>
  );
}

function DashboardChart({
  data,
  source,
  metric,
  label,
}: {
  data: AnalyticsDashboardDto;
  source: string;
  metric: string;
  label: string;
}) {
  const values = data.daily.map((day) => ({
    date: day.date,
    value: day.sources.find((item) => item.source === source)?.metrics?.[metric] ?? null,
  }));
  const present = values.flatMap((item) => (item.value == null ? [] : [item.value]));
  const max = Math.max(1, ...present);
  const width = 600 / Math.max(1, values.length);
  return (
    <figure className="dashboard-chart">
      <figcaption>
        {label}{" "}
        <span>
          {data.range.start}〜{data.range.end}
        </span>
      </figcaption>
      {!present.length ? (
        <EmptyState>この期間の日次データは未取得です。</EmptyState>
      ) : (
        <svg viewBox="0 0 600 100">
          <title>{label}の日別集計</title>
          {values.map((item, index) =>
            item.value == null ? null : (
              <rect
                key={item.date}
                x={index * width}
                y={94 - (84 * item.value) / max}
                width={Math.max(1, width - 2)}
                height={Math.max(1, (84 * item.value) / max)}
              >
                <title>{`${item.date}: ${number(item.value)}`}</title>
              </rect>
            ),
          )}
        </svg>
      )}
    </figure>
  );
}

interface Insight {
  key: string;
  title: string;
  evidence: string;
  period: string;
  priority: "P1" | "P2" | "P3";
  action: string;
  href: string;
  taskKind: DashboardTaskDto["kind"];
  articleId?: string | null;
}

function buildInsights(
  data: AnalyticsDashboardDto,
  articles: readonly ArticleSummaryDto[],
): Insight[] {
  const insights: Insight[] = [];
  const currentGsc = sourceMetrics(data.current, "gsc_site");
  const previousGsc = sourceMetrics(data.previous, "gsc_site");
  const ctr = currentGsc["ctr"];
  const previousCtr = previousGsc["ctr"];
  const impressions = currentGsc["impressions"];
  const clicks = currentGsc["clicks"];
  const previousClicks = previousGsc["clicks"];
  const period = `${data.range.start}〜${data.range.end} / 前期間 ${data.previousRange.start}〜${data.previousRange.end}`;
  if (
    ctr != null &&
    previousCtr != null &&
    impressions != null &&
    impressions >= 300 &&
    previousCtr - ctr >= 0.005
  ) {
    insights.push({
      key: "gsc-ctr",
      title: "検索表示に対してクリックが伸びていません",
      evidence: `CTR ${percent(previousCtr)} → ${percent(ctr)}（${difference(ctr, previousCtr, "rate")}）・表示 ${number(impressions)}回`,
      period,
      priority: impressions >= 1000 ? "P1" : "P2",
      action: "表示回数が多くCTRが下がった記事からタイトルと検索意図を確認",
      href: href.analytics(),
      taskKind: "seo",
    });
  }
  if (
    clicks != null &&
    previousClicks != null &&
    previousClicks >= 20 &&
    clicks <= previousClicks * 0.75
  ) {
    insights.push({
      key: "gsc-clicks",
      title: "検索クリックが前期間から減少",
      evidence: `${number(previousClicks)} → ${number(clicks)}クリック`,
      period,
      priority: previousClicks - clicks >= 30 ? "P1" : "P2",
      action: "記事別の表示・順位変化を確認",
      href: href.analytics(),
      taskKind: "seo",
    });
  }
  const chagee = (data.articles ?? [])
    .filter(
      (row) =>
        row.impressions != null &&
        row.impressions >= 100 &&
        row.clicksPrevious != null &&
        row.clicksPrevious >= 10,
    )
    .map((row) => {
      const currentPage = data.pages.gsc.find((page) => page.articleId === row.articleId);
      const previousPage = data.pagesPrevious.gsc.find((page) => page.articleId === row.articleId);
      const currentClicks = row.clicks ?? currentPage?.metrics["clicks"] ?? null;
      const currentImpressions = row.impressions ?? currentPage?.metrics["impressions"] ?? null;
      const currentCtr =
        currentClicks != null && currentImpressions != null && currentImpressions > 0
          ? currentClicks / currentImpressions
          : null;
      const previousCtrValue = previousPage?.metrics["ctr"] ?? null;
      const article = articles.find((item) => item.id === row.articleId);
      return { row, article, currentCtr, previousCtrValue };
    })
    .filter(
      (item) =>
        item.article &&
        isChagee(item.article) &&
        item.currentCtr != null &&
        item.previousCtrValue != null,
    )
    .toSorted(
      (a, b) => a.currentCtr! - a.previousCtrValue! - (b.currentCtr! - b.previousCtrValue!),
    )[0];
  if (chagee && chagee.currentCtr! < chagee.previousCtrValue!) {
    insights.push({
      key: `chagee-${chagee.row.articleId}`,
      title: "CHAGEE記事でCTRが低下",
      evidence: `${titleFor(chagee.article!)} · ${percent(chagee.previousCtrValue)} → ${percent(chagee.currentCtr)}`,
      period,
      priority: (chagee.row.impressions ?? 0) >= 1000 ? "P1" : "P2",
      action: "記事別の検索語と順位を確認",
      href: href.article(chagee.row.articleId),
      taskKind: "rewrite",
      articleId: chagee.row.articleId,
    });
  }
  const bodyEnd = measuredRate(data.articles, "bodyEndRate", "measuredViews");
  const previousBodyEnd = measuredRate(
    data.articles,
    "bodyEndRatePrevious",
    "measuredViewsPrevious",
  );
  if (bodyEnd != null && previousBodyEnd != null && bodyEnd <= previousBodyEnd - 0.05) {
    insights.push({
      key: "reading-depth",
      title: "本文末まで到達する割合が低下",
      evidence: `${percent(previousBodyEnd)} → ${percent(bodyEnd)} · 計測記事表示を分母`,
      period,
      priority: "P2",
      action: "Analyticsで端末・配置別の読者体験を確認",
      href: href.analytics(),
      taskKind: "rewrite",
    });
  }
  return insights.slice(0, 3);
}

function SearchAndChagee({
  data,
  articles,
}: {
  data: AnalyticsDashboardDto;
  articles: readonly ArticleSummaryDto[];
}) {
  const [group, setGroup] = useState("all");
  const reading = new Map((data.articles ?? []).map((row) => [row.articleId, row]));
  const currentPages = data.pages.gsc;
  const priorPages = data.pagesPrevious.gsc;
  const chageeArticles = articles.filter((item) => item.kind === "article" && isChagee(item));
  const rows = chageeArticles
    .filter((article) => {
      if (group === "all") return true;
      const key = `${article.title} ${article.slug} ${article.path ?? ""}`;
      if (group === "menu") return /menu|メニュー|おすすめ|価格/i.test(key);
      if (group === "store") return /store|店舗|店|location/i.test(key);
      if (group === "order") return /order|注文|頼み方|買い方/i.test(key);
      return !/menu|メニュー|おすすめ|価格|store|店舗|店|location|order|注文|頼み方|買い方/i.test(
        key,
      );
    })
    .map((article) => {
      const read = reading.get(article.id);
      const current = currentPages.find((item) => item.articleId === article.id);
      const previous = priorPages.find((item) => item.articleId === article.id);
      const clicks = read?.clicks ?? current?.metrics["clicks"] ?? null;
      const impressions = read?.impressions ?? current?.metrics["impressions"] ?? null;
      const ctr =
        clicks != null && impressions != null && impressions > 0 ? clicks / impressions : null;
      const previousCtr = previous?.metrics["ctr"] ?? null;
      const position = read?.position ?? current?.metrics["position"] ?? null;
      const previousPosition = read?.positionPrevious ?? previous?.metrics["position"] ?? null;
      return { article, read, clicks, impressions, ctr, previousCtr, position, previousPosition };
    })
    .toSorted((a, b) => (b.impressions ?? -1) - (a.impressions ?? -1));
  const queriesByTerm = new Map<string, Set<string>>();
  for (const query of data.queries) {
    if (!query.path) continue;
    const matching = rows.find(({ article }) => article.path === query.path);
    if (!matching) continue;
    const paths = queriesByTerm.get(query.key) ?? new Set<string>();
    paths.add(matching.article.id);
    queriesByTerm.set(query.key, paths);
  }
  const overlaps = [...queriesByTerm]
    .filter(([, ids]) => ids.size > 1)
    .toSorted((a, b) => b[1].size - a[1].size)
    .slice(0, 5);
  return (
    <>
      <Panel title="検索トレンド" actions={<a href={href.analytics()}>検索クエリ・流入の詳細 →</a>}>
        <p className="dashboard-note">
          GA4はプロパティ日付、Search
          Consoleは太平洋時間の日付で集計されています。欠損日はグラフで線をつないだり0扱いしたりしません。
        </p>
        <div className="dashboard-chart-grid">
          <DashboardChart data={data} source="gsc_site" metric="impressions" label="検索表示回数" />
          <DashboardChart data={data} source="gsc_site" metric="clicks" label="検索クリック" />
        </div>
      </Panel>
      <Panel
        title="CHAGEE 記事別比較"
        actions={<a href={href.analytics()}>Analyticsで全記事を見る →</a>}
      >
        <div className="dashboard-filter-row">
          <label>
            記事グループ
            <select value={group} onChange={(event) => setGroup(event.target.value)}>
              <option value="all">すべて</option>
              <option value="menu">メニュー・おすすめ</option>
              <option value="store">店舗</option>
              <option value="order">注文方法</option>
              <option value="other">その他</option>
            </select>
          </label>
          <span className="muted">分類は記事タイトル・slug・URLの語句から表示上のみ判定</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState>CHAGEE関連の記事が見つかりません。</EmptyState>
        ) : (
          <div className="dashboard-cards-list">
            {rows.map((row) => {
              const queries = data.queries.filter(
                (query) => query.path && query.path === row.article.path,
              );
              const ctrDelta =
                row.ctr != null && row.previousCtr != null ? row.ctr - row.previousCtr : null;
              const rankDelta =
                row.position != null && row.previousPosition != null
                  ? row.position - row.previousPosition
                  : null;
              return (
                <details className="dashboard-article-card" key={row.article.id}>
                  <summary>
                    <span className="dashboard-article-card__title">
                      <a
                        href={href.article(row.article.id)}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {titleFor(row.article)}
                      </a>
                    </span>
                    <span>表示 {number(row.impressions)}</span>
                    <span>クリック {number(row.clicks)}</span>
                    <span>CTR {percent(row.ctr)}</span>
                    <span>順位 {number(row.position, 1)}</span>
                  </summary>
                  <div className="dashboard-article-card__body">
                    <span>前期CTR {percent(row.previousCtr)}</span>
                    <span>
                      CTR差 {ctrDelta == null ? "—" : `${signed(ctrDelta * 100, 2)}ポイント`}
                    </span>
                    <span>前期順位 {number(row.previousPosition, 1)}</span>
                    <span>
                      順位変化{" "}
                      {rankDelta == null
                        ? "—"
                        : rankDelta < 0
                          ? `改善 ${Math.abs(rankDelta).toFixed(1)}`
                          : `低下 ${rankDelta.toFixed(1)}`}
                    </span>
                    <span>PV {number(row.read?.pageViews)}</span>
                    <span>
                      記事の最終本文更新{" "}
                      {row.article.contentUpdatedAt
                        ? row.article.contentUpdatedAt.slice(0, 10)
                        : "未取得"}
                    </span>
                  </div>
                  <div className="analytics-table">
                    <table>
                      <thead>
                        <tr>
                          <th>検索クエリ</th>
                          <th>クリック</th>
                          <th>CTR</th>
                          <th>平均順位</th>
                          <th>前期クリック</th>
                          <th>前期CTR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queries.slice(0, 8).map((query) => (
                          <tr key={`${query.key}-${query.path}`}>
                            <td>{query.key}</td>
                            <td>{number(query.metrics["clicks"])}</td>
                            <td>{percent(query.metrics["ctr"])}</td>
                            <td>{number(query.metrics["position"], 1)}</td>
                            <td>
                              {number(
                                data.queriesPrevious?.find(
                                  (previous) =>
                                    previous.path === query.path && previous.key === query.key,
                                )?.metrics["clicks"],
                              )}
                            </td>
                            <td>
                              {percent(
                                data.queriesPrevious?.find(
                                  (previous) =>
                                    previous.path === query.path && previous.key === query.key,
                                )?.metrics["ctr"],
                              )}
                            </td>
                          </tr>
                        ))}
                        {!queries.length && (
                          <tr>
                            <td colSpan={6}>記事別クエリは未取得です。</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        )}
        <div className="dashboard-overlaps">
          <h3>複数記事で表示された検索語</h3>
          {overlaps.length ? (
            <ul>
              {overlaps.map(([term, ids]) => (
                <li key={term}>
                  {term} · {ids.size}記事
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              現期間に重複候補は見つかりませんでした（匿名化クエリは含まれません）。
            </p>
          )}
        </div>
      </Panel>
    </>
  );
}

function AffiliateSummary({
  overview,
  articles,
  data,
}: {
  overview: MonetizationOverviewDto;
  articles: readonly ArticleSummaryDto[];
  data: AnalyticsDashboardDto | undefined;
}) {
  const articleMap = new Map(articles.map((item) => [item.id, item]));
  const reading = new Map((data?.articles ?? []).map((row) => [row.articleId, row]));
  const placements = overview.articles.flatMap((entry) =>
    entry.config.placements
      .filter((placement) => placement.kind === "affiliate" && placement.offerId)
      .map((placement) => ({
        entry,
        placement,
        offer: overview.offers.find((offer) => offer.id === placement.offerId),
      })),
  );
  const affiliateMetrics = sourceMetrics(data?.current, "affiliate");
  const totalClicks = affiliateMetrics["linkClicks"] ?? null;
  return (
    <>
      <div className="dashboard-inline-stats">
        <div>
          <small>ASPクリック（サイト合計）</small>
          <strong>{number(totalClicks)}</strong>
        </div>
        <div>
          <small>ASP成果（サイト合計）</small>
          <strong>
            {affiliateMetrics["confirmedConversions"] == null
              ? "未取得"
              : number(affiliateMetrics["confirmedConversions"])}
          </strong>
        </div>
        <div>
          <small>確定報酬（サイト合計）</small>
          <strong>
            {affiliateMetrics["confirmedRewardJPY"] == null
              ? "未取得"
              : `¥${number(affiliateMetrics["confirmedRewardJPY"])}`}
          </strong>
        </div>
        <div>
          <small>承認済み案件</small>
          <strong>
            {
              overview.offers.filter(
                (offer) => offer.status === "ready" && offer.publicationApproved,
              ).length
            }
          </strong>
        </div>
      </div>
      <p className="dashboard-note">
        記事別ASPクリック・成果は取得できていないため「未取得」としています。0件・0円としては扱いません。
      </p>
      {!placements.length ? (
        <EmptyState>記事へのアフィリエイト配置はありません。</EmptyState>
      ) : (
        <div className="analytics-table">
          <table>
            <thead>
              <tr>
                <th>提携サービス</th>
                <th>記事</th>
                <th>承認</th>
                <th>記事配置</th>
                <th>公開反映</th>
                <th>検索クリック / PV</th>
                <th>ASP</th>
              </tr>
            </thead>
            <tbody>
              {placements.map(({ entry, placement, offer }) => {
                const article = articleMap.get(entry.articleId);
                const published =
                  entry.published?.affiliates?.some(
                    (item) => item.provider === offer?.provider && item.heading === offer.heading,
                  ) ?? false;
                const state = !article?.isLive
                  ? "公開記事ではありません"
                  : published
                    ? "公開サイトに反映"
                    : "公開サイトに未反映";
                const readingRow = reading.get(entry.articleId);
                return (
                  <tr key={`${entry.articleId}-${placement.key}`}>
                    <td>
                      {offer?.provider ?? "案件未割当"}
                      <small>{offer?.name ?? placement.offerId}</small>
                    </td>
                    <td>
                      {article ? (
                        <a href={href.article(article.id)}>{titleFor(article)}</a>
                      ) : (
                        entry.articleId
                      )}
                    </td>
                    <td>
                      {offer?.status === "ready" && offer.publicationApproved
                        ? "承認済み"
                        : "未承認"}
                    </td>
                    <td>{placement.status === "ready" ? "有効" : "停止中"}</td>
                    <td>
                      {state}
                      {entry.needsPublication ? " · 記事変更未公開" : ""}
                    </td>
                    <td>
                      {number(readingRow?.clicks)} / {number(readingRow?.pageViews)}
                    </td>
                    <td>記事別未取得</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function MonetizationSummary({
  overview,
  articles,
  data,
}: {
  overview: MonetizationOverviewDto;
  articles: readonly ArticleSummaryDto[];
  data: AnalyticsDashboardDto | undefined;
}) {
  const adsense = sourceMetrics(data?.current, "adsense");
  const coverage = sourceCoverage(data?.current, "adsense");
  const audit = useMemo(() => auditArticles(articles, overview), [articles, overview]);
  const layoutCount = (layout: ReturnType<typeof adLayoutOf>) =>
    overview.articles.filter((item) => adLayoutOf(item.config) === layout).length;
  const running = overview.experiments.filter((item) => item.status === "running");
  const cohorts = data?.experiments?.current ?? [];
  const groups = new Map<string, typeof cohorts>();
  for (const cohort of cohorts) {
    const key = `${cohort.experimentId}|${cohort.device}|${cohort.layout}`;
    groups.set(key, [...(groups.get(key) ?? []), cohort]);
  }
  const activeGroups = [...groups.entries()].filter(([key]) =>
    running.some((item) => key.startsWith(`${item.id}|`)),
  );
  return (
    <>
      <div className="dashboard-inline-stats">
        <div>
          <small>AdSense推定収益</small>
          <strong>
            {adsense["estimatedEarningsJPY"] == null
              ? "未取得"
              : `¥${number(adsense["estimatedEarningsJPY"], 0)}`}
          </strong>
        </div>
        <div>
          <small>広告リクエスト</small>
          <strong>{number(adsense["adRequests"])}</strong>
        </div>
        <div>
          <small>広告表示回数</small>
          <strong>{number(adsense["adImpressions"])}</strong>
        </div>
        <div>
          <small>Page RPM</small>
          <strong>
            {adsense["pageRPMJPY"] == null ? "未取得" : `¥${number(adsense["pageRPMJPY"], 1)}`}
          </strong>
        </div>
        <div>
          <small>広告CTR</small>
          <strong>{percent(adsense["adCtr"])}</strong>
        </div>
        <div>
          <small>広告掲載中の公開記事</small>
          <strong>{number(overview.publishedAdArticles)}</strong>
        </div>
      </div>
      <p className="dashboard-note">
        AdSense{" "}
        {coverage
          ? `${coverage.coveredDays}/${coverage.expectedDays}日取得${coverage.provisional ? " · 暫定値" : ""}`
          : "未取得"}
        {data?.statuses.find((status) => status.source === "adsense" && status.error)?.error
          ? ` · 取得エラー: ${data?.statuses.find((status) => status.source === "adsense")?.error}`
          : ""}
        。収益はサイト推定値です。記事・A/Bへの按分はしていません。
      </p>
      <div className="dashboard-inline-stats dashboard-inline-stats--compact">
        <div>
          <small>標準配置</small>
          <strong>{layoutCount("standard")}</strong>
        </div>
        <div>
          <small>末尾のみ</small>
          <strong>{layoutCount("end-only")}</strong>
        </div>
        <div>
          <small>広告なし</small>
          <strong>{layoutCount("none")}</strong>
        </div>
        <div>
          <small>A/Bテスト中</small>
          <strong>{running.length}</strong>
        </div>
        <div>
          <small>配置見直し候補</small>
          <strong>{audit.filter((item) => item.fixable).length}</strong>
        </div>
      </div>
      {running.length > 0 && (
        <div className="analytics-table">
          <h3>A/Bテスト · 同一実験・端末・配置のみで比較</h3>
          <table>
            <thead>
              <tr>
                <th>実験 / 記事</th>
                <th>判定状況</th>
                <th>端末・variant</th>
                <th>日数 / 表示</th>
                <th>リクエスト率</th>
                <th>配信proxy</th>
                <th>視認proxy</th>
                <th>本文75% / 末尾</th>
                <th>次記事操作</th>
                <th>Core Web Vitals</th>
              </tr>
            </thead>
            <tbody>
              {activeGroups.map(([key, rows]) => {
                const experiment = running.find((item) => key.startsWith(`${item.id}|`));
                return rows.map((row) => (
                  <tr key={`${key}-${row.variant}`}>
                    <td>
                      {experiment?.name ?? row.experimentId}
                      <small>
                        {experiment && (
                          <>
                            <a href={href.article(experiment.articleId)}>記事を開く</a> · 開始{" "}
                            {experiment.startedAt?.slice(0, 10) ?? "未取得"}
                          </>
                        )}
                      </small>
                    </td>
                    <td>{row.reviewReady ? "見直し目安に到達" : "計測中・判定保留"}</td>
                    <td>
                      {row.device} · {row.layout} · {row.variant}
                    </td>
                    <td>
                      {row.measuredDays}日 / {row.views}表示
                    </td>
                    <td>{percent(row.adRequestRate)}</td>
                    <td>{percent(row.adFillRate)}</td>
                    <td>{percent(row.adViewableProxyRate)}</td>
                    <td>
                      {percent(row.body75Rate)} / {percent(row.bodyEndRate)}
                    </td>
                    <td>{percent(row.nextArticleRate)}</td>
                    <td>
                      {row.vitals
                        .map(
                          (vital) =>
                            `${vital.vital}:${vital.p75Band === "good" ? "良好" : vital.p75Band === "insufficient" ? "不足" : "要確認"}`,
                        )
                        .join(" / ") || "未取得"}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
          {!activeGroups.length && <EmptyState>この期間の実験別データは未取得です。</EmptyState>}
          <p className="dashboard-note">
            14計測日・各端末各パターン200表示は見直しの目安で、有意差を保証しません。条件未達は計測中・判定保留です。視認はproxyで、Active
            Viewやvariant別収益ではありません。
          </p>
        </div>
      )}
      <AffiliateSummary overview={overview} articles={articles} data={data} />
    </>
  );
}

function reportSource(report: AnalyticsReportDto, source: string) {
  return report.current.find((item) => item.source === source);
}
function reportPreviousSource(report: AnalyticsReportDto, source: string) {
  return report.previous.find((item) => item.source === source);
}
function reportPreviousRange(report: AnalyticsReportDto): Range {
  const length = daysBetween(report.start, report.end);
  return { start: shiftDate(report.start, -length), end: shiftDate(report.start, -1) };
}

const taskKindLabels: Record<DashboardTaskDto["kind"], string> = {
  seo: "SEO改善",
  rewrite: "リライト",
  ad_test: "広告配置の検証",
  affiliate: "アフィリエイト改善",
  publish: "記事公開",
  planning: "企画・執筆",
  operations: "公開エラー・サイト運用",
};
const taskStatusLabels: Record<DashboardTaskDto["status"], string> = {
  todo: "未着手",
  in_progress: "進行中",
  done: "完了",
  hold: "保留",
};
const ideaStatusLabels: Record<DashboardIdeaDto["status"], string> = {
  planning: "企画中",
  drafting: "執筆中",
  ready: "公開準備",
  scheduled: "予約公開",
  hold: "保留",
};

function TaskCreateForm({
  articles,
  onCreate,
}: {
  articles: readonly ArticleSummaryDto[];
  onCreate: (input: DashboardTaskInput) => Promise<void>;
}) {
  return (
    <details className="dashboard-create-form">
      <summary>運用タスクを登録</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          void onCreate({
            title: String(values.get("title") ?? ""),
            kind: String(values.get("kind")) as DashboardTaskDto["kind"],
            priority: String(values.get("priority")) as DashboardTaskDto["priority"],
            source: "manual",
            details: String(values.get("details") ?? ""),
            articleId: String(values.get("articleId") ?? "") || null,
            causeKey: null,
            evidenceStart: null,
            evidenceEnd: null,
            rule: null,
          })
            .then(() => form.reset())
            .catch(() => {});
        }}
      >
        <label>
          タスク名
          <input name="title" maxLength={180} required />
        </label>
        <div className="dashboard-form-grid">
          <label>
            種類
            <select name="kind" defaultValue="seo">
              {Object.entries(taskKindLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            優先度
            <select name="priority" defaultValue="P2">
              <option>P1</option>
              <option>P2</option>
              <option>P3</option>
            </select>
          </label>
          <label>
            対象記事
            <select name="articleId" defaultValue="">
              <option value="">なし</option>
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {titleFor(article)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          メモ
          <textarea name="details" rows={3} maxLength={2000} />
        </label>
        <button type="submit">登録</button>
      </form>
    </details>
  );
}

function IdeaCreateForm({
  series,
  articles,
  onCreate,
}: {
  series: readonly CollectionAdminDto[];
  articles: readonly ArticleSummaryDto[];
  onCreate: (input: DashboardIdeaInput) => Promise<void>;
}) {
  return (
    <details className="dashboard-create-form">
      <summary>新しい企画</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          void onCreate({
            provisionalTitle: String(values.get("provisionalTitle") ?? ""),
            articleKind: String(values.get("articleKind")) as DashboardIdeaInput["articleKind"],
            seriesId: String(values.get("seriesId") ?? "") || null,
            summary: String(values.get("summary") ?? ""),
            priority: String(values.get("priority")) as DashboardIdeaInput["priority"],
            status: "planning",
            relatedArticleId: String(values.get("relatedArticleId") ?? "") || null,
            linkedArticleId: null,
          })
            .then(() => form.reset())
            .catch(() => {});
        }}
      >
        <label>
          仮タイトル
          <input name="provisionalTitle" maxLength={180} required />
        </label>
        <div className="dashboard-form-grid">
          <label>
            記事種別
            <select name="articleKind">
              <option value="article">通常記事</option>
              <option value="page">固定ページ</option>
            </select>
          </label>
          <label>
            優先度
            <select name="priority" defaultValue="P2">
              <option>P1</option>
              <option>P2</option>
              <option>P3</option>
            </select>
          </label>
          <label>
            シリーズ
            <select name="seriesId" defaultValue="">
              <option value="">なし</option>
              {series.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            関連記事
            <select name="relatedArticleId" defaultValue="">
              <option value="">なし</option>
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {titleFor(article)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          概要・メモ
          <textarea name="summary" rows={3} maxLength={3000} />
        </label>
        <button type="submit">企画を保存</button>
      </form>
    </details>
  );
}

function IdeaEditForm({
  idea,
  series,
  articles,
  onSave,
}: {
  idea: DashboardIdeaDto;
  series: readonly CollectionAdminDto[];
  articles: readonly ArticleSummaryDto[];
  onSave: (input: DashboardIdeaInput) => Promise<void>;
}) {
  return (
    <details className="dashboard-create-form">
      <summary>企画の内容を編集</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void onSave({
            provisionalTitle: String(values.get("provisionalTitle") ?? ""),
            articleKind: String(values.get("articleKind")) as DashboardIdeaInput["articleKind"],
            seriesId: String(values.get("seriesId") ?? "") || null,
            summary: String(values.get("summary") ?? ""),
            priority: String(values.get("priority")) as DashboardIdeaInput["priority"],
            status: String(values.get("status")) as DashboardIdeaInput["status"],
            relatedArticleId: String(values.get("relatedArticleId") ?? "") || null,
            linkedArticleId: idea.linkedArticleId,
          }).catch(() => undefined);
        }}
      >
        <label>
          仮タイトル
          <input
            name="provisionalTitle"
            defaultValue={idea.provisionalTitle}
            maxLength={180}
            required
          />
        </label>
        <div className="dashboard-form-grid">
          <label>
            記事種別
            <select name="articleKind" defaultValue={idea.articleKind}>
              <option value="article">通常記事</option>
              <option value="page">固定ページ</option>
            </select>
          </label>
          <label>
            優先度
            <select name="priority" defaultValue={idea.priority}>
              <option>P1</option>
              <option>P2</option>
              <option>P3</option>
            </select>
          </label>
          <label>
            状態
            <select name="status" defaultValue={idea.status}>
              {Object.entries(ideaStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            シリーズ
            <select name="seriesId" defaultValue={idea.seriesId ?? ""}>
              <option value="">なし</option>
              {series.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            関連記事
            <select name="relatedArticleId" defaultValue={idea.relatedArticleId ?? ""}>
              <option value="">なし</option>
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {titleFor(article)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          概要・メモ
          <textarea name="summary" defaultValue={idea.summary} rows={3} maxLength={3000} />
        </label>
        <button type="submit">企画を更新</button>
      </form>
    </details>
  );
}

function ideaInputFrom(
  item: DashboardIdeaDto,
  patch: Partial<DashboardIdeaInput> = {},
): DashboardIdeaInput {
  return {
    provisionalTitle: item.provisionalTitle,
    articleKind: item.articleKind,
    seriesId: item.seriesId,
    summary: item.summary,
    priority: item.priority,
    status: item.status,
    relatedArticleId: item.relatedArticleId,
    linkedArticleId: item.linkedArticleId,
    ...patch,
  };
}

export function Dashboard() {
  useTitle("運営ダッシュボード");
  const toast = useToast();
  const [preset, setPreset] = useState<RangePreset>("28");
  const [range, setRange] = useState<Range>(initialRange);
  const [draftRange, setDraftRange] = useState<Range>(initialRange);
  const [reportKind, setReportKind] = useState<"weekly" | "monthly">("weekly");
  const [selectedSeries, setSelectedSeries] = useState("all");
  const [articleQuery, setArticleQuery] = useState("");
  const deferredArticleQuery = useDeferredValue(articleQuery);
  const [articleStatus, setArticleStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [region, setRegion] = useState("all");
  const [onlyChagee, setOnlyChagee] = useState(false);
  const [monetized, setMonetized] = useState("all");
  const [rewriteOnly, setRewriteOnly] = useState(false);
  const [unpublishedOnly, setUnpublishedOnly] = useState(false);
  const [sortBy, setSortBy] = useState("priority");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const analytics = useResource(
    () => api.analytics(range.start, range.end),
    `dashboard-analytics:${range.start}:${range.end}`,
  );
  const articles = useResource(() => api.listArticles().then((result) => result.items), "articles");
  const integrity = useResource(() => api.routeIntegrity(), "dashboard-integrity");
  const inquiries = useResource(async () => {
    const status = await api.inquiryStatus();
    if (!status.configured || !status.registered) return { status, open: null };
    return { status, open: await api.listTickets({ status: "open" }) };
  }, "dashboard-inquiries");
  const monetization = useResource(() => api.monetization(), "dashboard-monetization");
  const collections = useResource(
    () => api.listCollections("series").then((result) => result.items),
    "dashboard-series",
  );
  const taxonomy = useResource(
    () =>
      filtersOpen ? api.taxonomy() : Promise.resolve({ categories: [], tags: [], collections: [] }),
    `dashboard-taxonomy:${filtersOpen}`,
  );
  const locations = useResource(
    () => (filtersOpen ? api.listLocations().then((result) => result.items) : Promise.resolve([])),
    `dashboard-locations:${filtersOpen}`,
  );
  const reports = useResource(
    () => api.analyticsReports().then((result) => result.items),
    "dashboard-reports",
  );
  const tasks = useResource(
    () => api.dashboardTasks().then((result) => result.items),
    "dashboard-tasks",
  );
  const ideas = useResource(
    () => api.dashboardIdeas().then((result) => result.items),
    "dashboard-ideas",
  );
  const analyticsData = analytics.data;
  const articleItems = articles.data ?? emptyArticleList;
  const overview = monetization.data;
  const currentGa4 = sourceMetrics(analyticsData?.current, "ga4");
  const previousGa4 = sourceMetrics(analyticsData?.previous, "ga4");
  const currentGsc = sourceMetrics(analyticsData?.current, "gsc_site");
  const previousGsc = sourceMetrics(analyticsData?.previous, "gsc_site");
  const currentAds = sourceMetrics(analyticsData?.current, "adsense");
  const previousAds = sourceMetrics(analyticsData?.previous, "adsense");
  const body75 = measuredRate(analyticsData?.articles, "body75Rate", "measuredViews");
  const previousBody75 = measuredRate(
    analyticsData?.articles,
    "body75RatePrevious",
    "measuredViewsPrevious",
  );
  const nextRate = measuredRate(analyticsData?.articles, "nextArticleRate", "measuredViews");
  const previousNextRate = measuredRate(
    analyticsData?.articles,
    "nextArticleRatePrevious",
    "measuredViewsPrevious",
  );
  const insightItems = analyticsData ? buildInsights(analyticsData, articleItems) : [];
  const review = useMemo(() => {
    const byId = new Map(articleItems.map((article) => [article.id, article]));
    return (analyticsData?.articles ?? [])
      .map((row) => {
        const article = byId.get(row.articleId);
        const reasons = reviewReasons(row, article?.contentUpdatedAt ?? article?.updatedAt ?? null);
        const currentPage = analyticsData?.pages.gsc.find(
          (page) => page.articleId === row.articleId,
        );
        const previousPage = analyticsData?.pagesPrevious.gsc.find(
          (page) => page.articleId === row.articleId,
        );
        const currentClicks = row.clicks ?? currentPage?.metrics["clicks"] ?? null;
        const currentImpressions = row.impressions ?? currentPage?.metrics["impressions"] ?? null;
        const currentCtr =
          currentClicks != null && currentImpressions != null && currentImpressions > 0
            ? currentClicks / currentImpressions
            : null;
        const previousCtr = previousPage?.metrics["ctr"] ?? null;
        const highImpressionsLowCtr =
          (currentImpressions ?? 0) >= 300 && currentCtr != null && currentCtr < 0.02;
        if (highImpressionsLowCtr)
          reasons.unshift(`表示 ${number(currentImpressions)}回・CTR ${percent(currentCtr)}`);
        if (
          (currentImpressions ?? 0) >= 300 &&
          (previousPage?.metrics["impressions"] ?? 0) >= 300 &&
          currentCtr != null &&
          previousCtr != null &&
          previousCtr - currentCtr >= 0.01
        )
          reasons.push(`CTR低下 ${percent(previousCtr)}→${percent(currentCtr)}`);
        if (
          row.measuredViews >= 50 &&
          (row.measuredViewsPrevious ?? 0) >= 50 &&
          row.body75Rate != null &&
          row.body75RatePrevious != null &&
          row.body75RatePrevious - row.body75Rate >= 0.05
        )
          reasons.push(
            `本文75%到達率 ${percent(row.body75RatePrevious)}→${percent(row.body75Rate)}`,
          );
        const hasMonetization =
          overview?.articles
            .find((item) => item.articleId === row.articleId)
            ?.config.placements.some((placement) => placement.status === "ready") ?? false;
        if (reasons.length && hasMonetization) reasons.push("収益化設定あり");
        const score = Math.min(
          100,
          (currentImpressions ?? 0) / 50 +
            (row.clicksPrevious != null && row.clicks != null && row.clicksPrevious > row.clicks
              ? (row.clicksPrevious - row.clicks) * 0.5
              : 0) +
            (hasMonetization ? 5 : 0) +
            reasons.length * 12,
        );
        return {
          row,
          article,
          reasons,
          score,
          priority: (score >= 55
            ? "P1"
            : score >= 25
              ? "P2"
              : "P3") as DashboardTaskDto["priority"],
        };
      })
      .filter((item) => item.article && item.reasons.length > 0)
      .toSorted((a, b) => b.score - a.score);
  }, [analyticsData, articleItems, overview]);
  const activeRecommendationKeys = new Set([
    ...insightItems.map((item) => `recommendation:${item.key}`),
    ...review.map((item) => `rewrite:${item.row.articleId}:analytics-review`),
  ]);

  const gscRows = useMemo(
    () =>
      new Map(
        (analyticsData?.pages.gsc ?? []).map((row) => [row.articleId ?? row.path ?? row.key, row]),
      ),
    [analyticsData],
  );
  const readingRows = useMemo(
    () => new Map((analyticsData?.articles ?? []).map((row) => [row.articleId, row])),
    [analyticsData],
  );
  const monetizationByArticle = useMemo(
    () => new Map((overview?.articles ?? []).map((row) => [row.articleId, row])),
    [overview],
  );
  const rewriteIds = useMemo(() => new Set(review.map((item) => item.row.articleId)), [review]);
  const visibleArticles = useMemo(() => {
    const needle = deferredArticleQuery.trim().toLocaleLowerCase("ja-JP");
    let filtered = articleItems.filter((article) => article.kind === "article");
    if (needle)
      filtered = filtered.filter((article) =>
        `${article.title} ${article.slug} ${article.path ?? ""}`
          .toLocaleLowerCase("ja-JP")
          .includes(needle),
      );
    if (articleStatus !== "all")
      filtered = filtered.filter((article) =>
        articleStatus === "live"
          ? is("live", "changed")(article)
          : articleStatus === "changed"
            ? is("changed")(article)
            : articleStatus === "draft"
              ? is("draft", "withdrawn")(article)
              : articleStatus === "scheduled"
                ? is("scheduled")(article)
                : is("archived")(article),
      );
    if (selectedSeries !== "all")
      filtered = filtered.filter((article) => article.collectionIds?.includes(selectedSeries));
    if (category !== "all")
      filtered = filtered.filter((article) => article.categoryIds?.includes(category));
    if (region !== "all")
      filtered = filtered.filter((article) => article.locationIds?.includes(region));
    if (onlyChagee) filtered = filtered.filter(isChagee);
    if (monetized === "yes")
      filtered = filtered.filter(
        (article) => monetizationByArticle.get(article.id)?.config.mode !== "none",
      );
    if (monetized === "no")
      filtered = filtered.filter(
        (article) =>
          !monetizationByArticle.has(article.id) ||
          monetizationByArticle.get(article.id)?.config.mode === "none",
      );
    if (rewriteOnly) filtered = filtered.filter((article) => rewriteIds.has(article.id));
    if (unpublishedOnly) filtered = filtered.filter((article) => article.hasUnpublishedChanges);
    const metric = (article: ArticleSummaryDto, field: string) => {
      const row = readingRows.get(article.id);
      const page = gscRows.get(article.id);
      const clicks = row?.clicks ?? page?.metrics["clicks"];
      const impressions = row?.impressions ?? page?.metrics["impressions"];
      const value =
        field === "clicks"
          ? clicks
          : field === "impressions"
            ? impressions
            : field === "ctr"
              ? clicks != null && impressions != null && impressions > 0
                ? clicks / impressions
                : null
              : field === "position"
                ? (row?.position ?? page?.metrics["position"])
                : field === "pageViews"
                  ? row?.pageViews
                  : null;
      return value ?? null;
    };
    return filtered.toSorted((left, right) => {
      if (sortBy === "updated")
        return (right.contentUpdatedAt ?? right.updatedAt).localeCompare(
          left.contentUpdatedAt ?? left.updatedAt,
        );
      if (sortBy === "priority")
        return (
          (review.find((item) => item.row.articleId === right.id)?.score ?? 0) -
          (review.find((item) => item.row.articleId === left.id)?.score ?? 0)
        );
      const key =
        sortBy === "clicks"
          ? "clicks"
          : sortBy === "ctr"
            ? "ctr"
            : sortBy === "position"
              ? "position"
              : "impressions";
      const a = metric(left, key),
        b = metric(right, key);
      if (a == null) return b == null ? 0 : 1;
      if (b == null) return -1;
      return sortBy === "position" ? a - b : b - a;
    });
  }, [
    articleItems,
    deferredArticleQuery,
    articleStatus,
    selectedSeries,
    category,
    region,
    onlyChagee,
    monetized,
    rewriteOnly,
    unpublishedOnly,
    sortBy,
    monetizationByArticle,
    rewriteIds,
    readingRows,
    gscRows,
    review,
  ]);

  const operationalCounts = (predicate: (item: ArticleSummaryDto) => boolean) =>
    articleItems.filter(predicate).length;
  const pending = articleItems
    .filter(is("changed", "draft", "withdrawn"))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const scheduled = articleItems
    .filter(is("scheduled"))
    .toSorted((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const allSeries = collections.data ?? [];
  const ideaItems = ideas.data ?? [];
  const seriesArticles = articleItems.filter((item) => item.kind === "article");
  const activeSeries =
    selectedSeries === "all" ? allSeries : allSeries.filter((item) => item.id === selectedSeries);
  const latestStatus = analyticsData?.statuses
    .map((status) => status.attemptedAt)
    .filter((value): value is string => Boolean(value))
    .toSorted()
    .at(-1);

  const setPresetRange = (key: Exclude<RangePreset, "custom">) => {
    setPreset(key);
    const next =
      key === "week"
        ? completedWeek()
        : key === "month"
          ? completedMonth()
          : recentRange(Number(key));
    setRange(next);
    setDraftRange(next);
  };
  const refresh = () => {
    void Promise.all([
      analytics.reload(),
      articles.reload(),
      integrity.reload(),
      inquiries.reload(),
      monetization.reload(),
      collections.reload(),
      taxonomy.reload(),
      locations.reload(),
      reports.reload(),
      tasks.reload(),
      ideas.reload(),
    ]);
  };
  const createTask = async (input: DashboardTaskInput) => {
    try {
      const result = await api.createDashboardTask(input);
      toast.info(
        result.created
          ? "タスクを登録しました。"
          : "同じ改善候補のタスクが登録済みです。既存タスクを表示します。",
      );
      await tasks.reload();
    } catch (error) {
      toast.error(error);
      throw error;
    }
  };
  const registerInsight = (item: Insight) =>
    createTask({
      title: item.title,
      kind: item.taskKind,
      priority: item.priority,
      source: "recommendation",
      details: `${item.evidence}\n${item.period}\n推奨: ${item.action}`,
      articleId: item.articleId ?? null,
      causeKey: `recommendation:${item.key}`,
      evidenceStart: range.start,
      evidenceEnd: range.end,
      rule: item.key,
    });
  const registerRewrite = (item: (typeof review)[number]) =>
    createTask({
      title: `リライト確認: ${item.article ? titleFor(item.article) : (item.row.path ?? item.row.articleId)}`,
      kind: "rewrite",
      priority: item.priority,
      source: "recommendation",
      details: `${item.reasons.join(" · ")}\n対象期間: ${dateLabel(range)}\n指標の変化から抽出した確認候補です。`,
      articleId: item.row.articleId,
      causeKey: `rewrite:${item.row.articleId}:analytics-review`,
      evidenceStart: range.start,
      evidenceEnd: range.end,
      rule: "analytics-review",
    });
  const updateTaskStatus = async (task: DashboardTaskDto, status: DashboardTaskDto["status"]) => {
    try {
      await api.updateDashboardTaskStatus(task.id, status);
      await tasks.reload();
    } catch (error) {
      toast.error(error);
    }
  };
  const createIdea = async (input: DashboardIdeaInput) => {
    try {
      await api.createDashboardIdea(input);
      toast.info("企画を保存しました。");
      await ideas.reload();
    } catch (error) {
      toast.error(error);
      throw error;
    }
  };
  const updateIdea = async (idea: DashboardIdeaDto, patch: Partial<DashboardIdeaInput>) => {
    try {
      await api.updateDashboardIdea(idea.id, ideaInputFrom(idea, patch));
      await ideas.reload();
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="dashboard">
      <PageHeader
        title="運営ダッシュボード"
        meta={<span>分析対象を選び、今日の改善作業と記事運用をまとめて確認します。</span>}
        actions={
          <button type="button" onClick={refresh} disabled={analytics.loading}>
            更新
          </button>
        }
      />

      <Panel title="期間とデータ更新">
        <div className="dashboard-periods" role="toolbar" aria-label="分析期間">
          {(
            [
              ["7", "直近7日"],
              ["28", "直近28日"],
              ["90", "直近90日"],
              ["week", "直近の完了週"],
              ["month", "直近の完了月"],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              aria-pressed={preset === key}
              key={key}
              onClick={() => setPresetRange(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="dashboard-period-form"
          onSubmit={(event) => {
            event.preventDefault();
            const count = daysBetween(draftRange.start, draftRange.end);
            if (count < 1 || count > 93) return;
            setPreset("custom");
            setRange(draftRange);
          }}
        >
          <label>
            開始日
            <input
              type="date"
              max={draftRange.end}
              value={draftRange.start}
              onChange={(event) =>
                setDraftRange((value) => ({ ...value, start: event.target.value }))
              }
              required
            />
          </label>
          <label>
            終了日
            <input
              type="date"
              min={draftRange.start}
              max={dateInTokyo()}
              value={draftRange.end}
              onChange={(event) =>
                setDraftRange((value) => ({ ...value, end: event.target.value }))
              }
              required
            />
          </label>
          <button type="submit">この期間を表示</button>
          {daysBetween(draftRange.start, draftRange.end) > 93 && (
            <span role="alert">期間は93日以内で指定してください。</span>
          )}
        </form>
        <div className="dashboard-freshness">
          <span>対象期間: {dateLabel(range)}</span>
          {analyticsData && <span>比較期間: {dateLabel(analyticsData.previousRange)}</span>}
          <span>最終取得開始: {latestStatus ? formatDateTime(latestStatus) : "未取得"}</span>
          {analyticsData?.statuses.some((status) => status.error) && (
            <Badge tone="warn">一部データ取得エラー</Badge>
          )}
        </div>
      </Panel>

      <section aria-label="KPIサマリー">
        <h2 className="dashboard-section-heading">サイト状況</h2>
        {analytics.error !== undefined && (
          <ErrorState error={analytics.error} onRetry={() => void analytics.reload()} />
        )}
        {analytics.loading && !analyticsData && (
          <div className="dashboard-kpis">
            <SkeletonRows rows={2} />
          </div>
        )}
        {analyticsData && (
          <div className="dashboard-kpis">
            <MetricCard
              label="GA4 ページビュー"
              current={currentGa4["pageViews"] ?? null}
              previous={previousGa4["pageViews"] ?? null}
              source="ga4"
              data={analyticsData}
            />
            <MetricCard
              label="GSC 表示回数"
              current={currentGsc["impressions"] ?? null}
              previous={previousGsc["impressions"] ?? null}
              source="gsc_site"
              data={analyticsData}
            />
            <MetricCard
              label="GSC クリック数"
              current={currentGsc["clicks"] ?? null}
              previous={previousGsc["clicks"] ?? null}
              source="gsc_site"
              data={analyticsData}
            />
            <MetricCard
              label="検索CTR"
              current={currentGsc["ctr"] ?? null}
              previous={previousGsc["ctr"] ?? null}
              format={percent}
              changeKind="rate"
              source="gsc_site"
              data={analyticsData}
            />
            <MetricCard
              label="平均掲載順位"
              current={currentGsc["position"] ?? null}
              previous={previousGsc["position"] ?? null}
              format={(value) => number(value, 1)}
              changeKind="position"
              source="gsc_site"
              data={analyticsData}
            />
            <MetricCard
              label="AdSense推定収益"
              current={currentAds["estimatedEarningsJPY"] ?? null}
              previous={previousAds["estimatedEarningsJPY"] ?? null}
              format={(value) => (value == null ? "未取得" : `¥${number(value)}`)}
              source="adsense"
              data={analyticsData}
            />
            <MetricCard
              label="本文75%到達率"
              current={body75}
              previous={previousBody75}
              format={percent}
              changeKind="rate"
              source="ga4"
              data={analyticsData}
              detail={`${number(analyticsData.articles?.reduce((sum, row) => sum + row.measuredViews, 0) ?? 0)}計測記事表示 · ${analyticsData.readerCoverage?.currentDays ?? 0}/${daysBetween(analyticsData.range.start, analyticsData.range.end)}日で計測`}
            />
            <MetricCard
              label="次記事への遷移操作率"
              current={nextRate}
              previous={previousNextRate}
              format={percent}
              changeKind="rate"
              source="ga4"
              data={analyticsData}
              detail={`計測記事表示を分母 · ${analyticsData.readerCoverage?.currentDays ?? 0}/${daysBetween(analyticsData.range.start, analyticsData.range.end)}日で計測`}
            />
          </div>
        )}
        <p className="dashboard-note">
          CTR・到達率は差分をパーセントポイントで表示します。順位は数字が小さいほど改善です。取得日数が違う期間、欠損や暫定値を含む期間の差は参考値です。ユーザー数の期間値を日次合算していません。
        </p>
      </section>

      <section className="dashboard-grid dashboard-grid--main">
        <Panel title="今週の注目ポイント" actions={<a href={href.analytics()}>分析を確認 →</a>}>
          {!analyticsData ? (
            analytics.loading ? (
              <SkeletonRows rows={3} />
            ) : (
              <EmptyState>分析データを表示できません。</EmptyState>
            )
          ) : insightItems.length ? (
            <ul className="dashboard-insights">
              {insightItems.map((item) => (
                <li key={item.key}>
                  <div>
                    <Badge tone={item.priority === "P1" ? "danger" : "warn"}>{item.priority}</Badge>
                    <strong>{item.title}</strong>
                  </div>
                  <p>{item.evidence}</p>
                  <small>{item.period}</small>
                  <a href={item.href}>{item.action} →</a>
                  <button
                    type="button"
                    onClick={() => void registerInsight(item)}
                    disabled={tasks.data?.some(
                      (task) => task.causeKey === `recommendation:${item.key}`,
                    )}
                  >
                    {tasks.data?.some((task) => task.causeKey === `recommendation:${item.key}`)
                      ? "タスク登録済み"
                      : "タスクに登録"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>現期間は、定義済みルールで優先して知らせる変化がありません。</EmptyState>
          )}
        </Panel>
        <Panel title="次にやること" actions={<a href={href.articles()}>記事を管理 →</a>}>
          <ul className="dashboard-next-actions">
            {review.slice(0, 3).map((item) => (
              <li key={item.row.articleId}>
                <Badge tone={item.priority === "P1" ? "danger" : "warn"}>{item.priority}</Badge>
                <div>
                  <a href={href.article(item.row.articleId)}>
                    {item.article ? titleFor(item.article) : item.row.path}
                  </a>
                  <small>{item.reasons.slice(0, 2).join(" · ")}</small>
                  <button
                    type="button"
                    onClick={() => void registerRewrite(item)}
                    disabled={tasks.data?.some(
                      (task) => task.causeKey === `rewrite:${item.row.articleId}:analytics-review`,
                    )}
                  >
                    {tasks.data?.some(
                      (task) => task.causeKey === `rewrite:${item.row.articleId}:analytics-review`,
                    )
                      ? "タスク登録済み"
                      : "タスクに登録"}
                  </button>
                </div>
              </li>
            ))}
            {overview &&
              auditArticles(articleItems, overview)
                .filter((item) => item.fixable)
                .slice(0, Math.max(0, 3 - Math.min(3, review.length)))
                .map((item) => (
                  <li key={`ads-${item.article.id}`}>
                    <Badge tone="warn">P2</Badge>
                    <div>
                      <a href={href.article(item.article.id)}>{titleFor(item.article)}</a>
                      <small>広告配置の確認: {adAuditLabels[item.kind].label}</small>
                    </div>
                  </li>
                ))}
            {!review.length &&
              !overview?.articles.some((item) => adLayoutOf(item.config) === "end-only") && (
                <li>
                  <span>現時点で優先度の高い自動候補はありません。</span>
                </li>
              )}
          </ul>
          <p className="dashboard-note">
            自動候補です。タスク登録や記事・広告設定の変更は行っていません。根拠と対象期間を確認してから既存画面で操作してください。
          </p>
        </Panel>
      </section>

      <Panel
        title="登録済み運用タスク"
        actions={<span>状態はD1に保存され、他の端末と共有されます。</span>}
      >
        <TaskCreateForm articles={articleItems} onCreate={createTask} />
        {tasks.error !== undefined && (
          <ErrorState error={tasks.error} onRetry={() => void tasks.reload()} />
        )}
        {tasks.loading && !tasks.data ? (
          <SkeletonRows rows={3} />
        ) : (tasks.data ?? []).length === 0 ? (
          <EmptyState>
            登録済みタスクはありません。改善候補を正式登録するか、手動で追加できます。
          </EmptyState>
        ) : (
          <ul className="dashboard-task-list">
            {(tasks.data ?? []).slice(0, 20).map((task) => {
              const article = task.articleId
                ? articleItems.find((item) => item.id === task.articleId)
                : null;
              const needsReview =
                task.source === "recommendation" &&
                task.causeKey !== null &&
                !activeRecommendationKeys.has(task.causeKey);
              return (
                <li key={task.id}>
                  <div className="dashboard-task-list__main">
                    <div>
                      <Badge
                        tone={
                          task.priority === "P1"
                            ? "danger"
                            : task.priority === "P2"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {task.priority}
                      </Badge>
                      <Badge>{task.source === "manual" ? "手動登録" : "自動候補から登録"}</Badge>
                      {needsReview && (
                        <Badge tone="warn">現期間の自動候補に非該当・再評価してください</Badge>
                      )}
                      <strong>{task.title}</strong>
                    </div>
                    <small>
                      {taskKindLabels[task.kind]} · {task.details}
                    </small>
                    <small>
                      {task.evidenceStart && task.evidenceEnd
                        ? `根拠期間 ${task.evidenceStart}〜${task.evidenceEnd}`
                        : ""}
                      {task.rule ? ` · 判定ルール ${task.rule}` : ""}
                    </small>
                    {article && <a href={href.article(article.id)}>{titleFor(article)} →</a>}
                  </div>
                  <label className="dashboard-task-status">
                    状態
                    <select
                      aria-label={`タスク状態: ${taskStatusLabels[task.status]}`}
                      value={task.status}
                      onChange={(event) =>
                        void updateTaskStatus(
                          task,
                          event.target.value as DashboardTaskDto["status"],
                        )
                      }
                    >
                      <option value="todo">未着手</option>
                      <option value="in_progress">進行中</option>
                      <option value="done">完了</option>
                      <option value="hold">保留</option>
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {analyticsData && (
        <section className="dashboard-grid dashboard-grid--main">
          <SearchAndChagee data={analyticsData} articles={articleItems} />
        </section>
      )}

      <Panel
        title="広告・アフィリエイトの改善状況"
        actions={<a href={href.monetization()}>収益化の設定・監査へ →</a>}
      >
        {monetization.error !== undefined && (
          <ErrorState error={monetization.error} onRetry={() => void monetization.reload()} />
        )}
        {monetization.loading && !overview ? (
          <SkeletonRows rows={5} />
        ) : overview ? (
          <MonetizationSummary overview={overview} articles={articleItems} data={analyticsData} />
        ) : (
          <EmptyState>収益化サマリーの一部を取得できません。</EmptyState>
        )}
      </Panel>

      <section className="dashboard-grid dashboard-grid--main">
        <Panel title="リライト候補" actions={<a href={href.analytics()}>記事別分析 →</a>}>
          {analytics.error ? (
            <ErrorState error={analytics.error} onRetry={() => void analytics.reload()} />
          ) : !review.length ? (
            <EmptyState>現期間に定義済みルールへ該当する記事はありません。</EmptyState>
          ) : (
            <ul className="dashboard-review-list">
              {review.slice(0, 8).map(({ row, article, reasons, priority }) => (
                <li key={row.articleId}>
                  <Badge
                    tone={priority === "P1" ? "danger" : priority === "P2" ? "warn" : "neutral"}
                  >
                    {priority}
                  </Badge>
                  <div>
                    <a href={href.article(row.articleId)}>
                      {article ? titleFor(article) : row.path}
                    </a>
                    <small>{reasons.join(" · ")}</small>
                    <small>
                      CTR {percent(row.impressions ? (row.clicks ?? 0) / row.impressions : null)} ·
                      順位 {number(row.position, 1)} · 前期クリック {number(row.clicksPrevious)} →{" "}
                      {number(row.clicks)}
                    </small>
                    <small>
                      本文更新{" "}
                      {article?.contentUpdatedAt ? article.contentUpdatedAt.slice(0, 10) : "未取得"}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="dashboard-note">
            高表示回数、低CTR、クリック減、順位低下、更新日、読者体験の確認を組み合わせた候補です。編集後の変化だけで因果を断定しません。
          </p>
        </Panel>
        <Panel
          title="制作パイプライン・シリーズ別状況"
          actions={<a href={href.articles()}>記事一覧 →</a>}
        >
          <div className="dashboard-filter-row">
            <label>
              シリーズ
              <select
                value={selectedSeries}
                onChange={(event) => setSelectedSeries(event.target.value)}
              >
                <option value="all">すべて</option>
                {allSeries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="dashboard-inline-stats dashboard-inline-stats--compact">
            <div>
              <small>公開済み</small>
              <strong>
                {seriesArticles.filter((item) => item.isLive && !item.hasUnpublishedChanges).length}
              </strong>
            </div>
            <div>
              <small>下書き</small>
              <strong>{seriesArticles.filter(is("draft", "withdrawn")).length}</strong>
            </div>
            <div>
              <small>公開準備・未反映</small>
              <strong>{seriesArticles.filter(is("changed")).length}</strong>
            </div>
            <div>
              <small>予約公開</small>
              <strong>{seriesArticles.filter(is("scheduled")).length}</strong>
            </div>
          </div>
          <div className="dashboard-series-list">
            {activeSeries.map((series) => {
              const members = seriesArticles.filter((item) =>
                item.collectionIds?.includes(series.id),
              );
              return (
                <article key={series.id}>
                  <strong>{series.title}</strong>
                  <span>
                    公開{" "}
                    {members.filter((item) => item.isLive && !item.hasUnpublishedChanges).length}
                  </span>
                  <span>下書き {members.filter(is("draft", "withdrawn")).length}</span>
                  <span>
                    企画中{" "}
                    {
                      ideaItems.filter(
                        (idea) => idea.seriesId === series.id && idea.status !== "hold",
                      ).length
                    }
                  </span>
                </article>
              );
            })}
            {!activeSeries.length && <EmptyState>シリーズはありません。</EmptyState>}
          </div>
          <IdeaCreateForm series={allSeries} articles={articleItems} onCreate={createIdea} />
          {ideas.error !== undefined && (
            <ErrorState error={ideas.error} onRetry={() => void ideas.reload()} />
          )}
          {ideas.loading && !ideas.data ? (
            <SkeletonRows rows={2} />
          ) : (
            <ul className="dashboard-idea-list">
              {ideaItems
                .filter((idea) => selectedSeries === "all" || idea.seriesId === selectedSeries)
                .map((idea) => {
                  const availableArticles = articleItems.filter(
                    (article) =>
                      article.kind === idea.articleKind &&
                      !ideaItems.some(
                        (other) => other.id !== idea.id && other.linkedArticleId === article.id,
                      ),
                  );
                  const linked = articleItems.find(
                    (article) => article.id === idea.linkedArticleId,
                  );
                  return (
                    <li key={idea.id}>
                      <div>
                        <Badge
                          tone={
                            idea.priority === "P1"
                              ? "danger"
                              : idea.priority === "P2"
                                ? "warn"
                                : "neutral"
                          }
                        >
                          {idea.priority}
                        </Badge>
                        <strong>{idea.provisionalTitle}</strong>
                        <small>
                          {idea.articleKind === "article" ? "通常記事の企画" : "固定ページの企画"} ·{" "}
                          {idea.seriesId
                            ? (allSeries.find((series) => series.id === idea.seriesId)?.title ??
                              "シリーズ未取得")
                            : "シリーズなし"}
                        </small>
                        <small>{idea.summary || "概要メモなし"}</small>
                      </div>
                      <IdeaEditForm
                        idea={idea}
                        series={allSeries}
                        articles={articleItems}
                        onSave={(input) => updateIdea(idea, input)}
                      />
                      <label>
                        進行
                        <select
                          value={idea.status}
                          onChange={(event) =>
                            void updateIdea(idea, {
                              status: event.target.value as DashboardIdeaDto["status"],
                            })
                          }
                        >
                          {Object.entries(ideaStatusLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        既存記事との関連付け
                        <select
                          value={idea.linkedArticleId ?? ""}
                          onChange={(event) =>
                            void updateIdea(idea, { linkedArticleId: event.target.value || null })
                          }
                        >
                          <option value="">未関連付け</option>
                          {linked && <option value={linked.id}>{titleFor(linked)}</option>}
                          {availableArticles
                            .filter((article) => article.id !== linked?.id)
                            .map((article) => (
                              <option key={article.id} value={article.id}>
                                {titleFor(article)} · {phaseOfLabel(article)}
                              </option>
                            ))}
                        </select>
                      </label>
                      {linked && <a href={href.article(linked.id)}>関連する記事を編集 →</a>}
                    </li>
                  );
                })}
              {!ideaItems.some(
                (idea) => selectedSeries === "all" || idea.seriesId === selectedSeries,
              ) && (
                <li>
                  <span>企画はありません。</span>
                </li>
              )}
            </ul>
          )}
          <p className="dashboard-note">
            企画は記事レコードと分けて保存します。記事管理の新規作成で企画を選ぶと、下書き作成時に関連付けを保存します。既存記事も手動で関連付けでき、同じ記事を複数企画に重複登録できません。通常記事・固定ページが対象で、「ともきちの一言日記」の管理フローには触れません。
          </p>
        </Panel>
      </section>

      <Panel
        title="記事一覧・期間別パフォーマンス"
        actions={<a href={href.articles()}>記事管理へ →</a>}
      >
        <p className="dashboard-note">
          分析データがない記事も一覧に残し、数値は未取得として表示します。検索CTRはクリック数÷表示回数で算出します。
        </p>
        <div className="dashboard-filter-row dashboard-filter-row--search">
          <label>
            記事検索
            <input
              type="search"
              value={articleQuery}
              onChange={(event) => setArticleQuery(event.target.value)}
              placeholder="タイトル / slug"
            />
          </label>
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            {filtersOpen ? "絞り込みを閉じる" : "絞り込み"}
          </button>
          <label>
            並び替え
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="priority">改善優先度</option>
              <option value="impressions">表示回数</option>
              <option value="clicks">クリック数</option>
              <option value="ctr">CTR</option>
              <option value="position">平均順位</option>
              <option value="updated">本文更新日</option>
            </select>
          </label>
        </div>
        {filtersOpen && (
          <div className="dashboard-filters">
            <label>
              公開状態
              <select
                value={articleStatus}
                onChange={(event) => setArticleStatus(event.target.value)}
              >
                <option value="all">すべて</option>
                <option value="live">公開中</option>
                <option value="changed">変更未公開</option>
                <option value="draft">下書き・非公開</option>
                <option value="scheduled">予約公開</option>
                <option value="archived">アーカイブ</option>
              </select>
            </label>
            <label>
              シリーズ
              <select
                value={selectedSeries}
                onChange={(event) => setSelectedSeries(event.target.value)}
              >
                <option value="all">すべて</option>
                {allSeries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              カテゴリー
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">すべて</option>
                {(taxonomy.data?.categories ?? []).map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              地域
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                <option value="all">すべて</option>
                {(locations.data ?? []).map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              収益化
              <select value={monetized} onChange={(event) => setMonetized(event.target.value)}>
                <option value="all">すべて</option>
                <option value="yes">あり</option>
                <option value="no">なし</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={onlyChagee}
                onChange={(event) => setOnlyChagee(event.target.checked)}
              />{" "}
              CHAGEE関連記事
            </label>
            <label>
              <input
                type="checkbox"
                checked={rewriteOnly}
                onChange={(event) => setRewriteOnly(event.target.checked)}
              />{" "}
              リライト候補のみ
            </label>
            <label>
              <input
                type="checkbox"
                checked={unpublishedOnly}
                onChange={(event) => setUnpublishedOnly(event.target.checked)}
              />{" "}
              未公開変更あり
            </label>
          </div>
        )}
        {articles.error !== undefined && (
          <ErrorState error={articles.error} onRetry={() => void articles.reload()} />
        )}
        {articles.loading && !articles.data ? (
          <SkeletonRows rows={5} />
        ) : (
          <>
            <p className="muted">
              {visibleArticles.length}件 · {range.start}〜{range.end}
            </p>
            <div className="dashboard-article-table analytics-table">
              <table>
                <thead>
                  <tr>
                    <th>記事</th>
                    <th>公開状態</th>
                    <th>シリーズ</th>
                    <th>本文更新</th>
                    <th>表示</th>
                    <th>クリック</th>
                    <th>CTR</th>
                    <th>順位</th>
                    <th>PV</th>
                    <th>見直し</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleArticles.slice(0, 100).map((article) => {
                    const reading = readingRows.get(article.id);
                    const currentPage = gscRows.get(article.id);
                    const clicks = reading?.clicks ?? currentPage?.metrics["clicks"] ?? null;
                    const impressions =
                      reading?.impressions ?? currentPage?.metrics["impressions"] ?? null;
                    const ctr =
                      clicks != null && impressions != null && impressions > 0
                        ? clicks / impressions
                        : null;
                    const collectionNames = (article.collectionIds ?? [])
                      .map((id) => allSeries.find((series) => series.id === id)?.title)
                      .filter(Boolean);
                    const rewrite = review.find((item) => item.row.articleId === article.id);
                    return (
                      <tr key={article.id}>
                        <td data-label="記事">
                          <a href={href.article(article.id)}>{titleFor(article)}</a>
                          <small>{article.slug}</small>
                        </td>
                        <td data-label="公開状態">
                          <PhaseBadge article={article} />
                        </td>
                        <td data-label="シリーズ">{collectionNames.join("、") || "—"}</td>
                        <td data-label="本文更新">
                          {article.contentUpdatedAt?.slice(0, 10) ?? "未取得"}
                        </td>
                        <td data-label="表示">{number(impressions)}</td>
                        <td data-label="クリック">{number(clicks)}</td>
                        <td data-label="CTR">{percent(ctr)}</td>
                        <td data-label="順位">
                          {number(reading?.position ?? currentPage?.metrics["position"], 1)}
                        </td>
                        <td data-label="PV">{number(reading?.pageViews)}</td>
                        <td data-label="見直し">
                          {rewrite ? (
                            <a href={href.article(article.id)}>{rewrite.priority}</a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel title="週次・月次分析の履歴" actions={<a href={href.analytics()}>Analyticsへ →</a>}>
        <div className="dashboard-periods" role="tablist" aria-label="レポート種別">
          <button
            type="button"
            role="tab"
            aria-selected={reportKind === "weekly"}
            onClick={() => setReportKind("weekly")}
          >
            週次
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={reportKind === "monthly"}
            onClick={() => setReportKind("monthly")}
          >
            月次
          </button>
        </div>
        {reports.error !== undefined && (
          <ErrorState error={reports.error} onRetry={() => void reports.reload()} />
        )}
        {reports.loading && !reports.data ? (
          <SkeletonRows rows={3} />
        ) : (reports.data ?? []).filter((report) => report.period === reportKind).length === 0 ? (
          <EmptyState>保存済みレポートはありません。</EmptyState>
        ) : (
          <div className="dashboard-reports">
            {(reports.data ?? [])
              .filter((report) => report.period === reportKind)
              .map((report) => {
                const ga4 = reportSource(report, "ga4");
                const gsc = reportSource(report, "gsc_site");
                const ads = reportSource(report, "adsense");
                return (
                  <details key={`${report.period}-${report.start}`}>
                    <summary>
                      {report.start}〜{report.end} · 前期間 {dateLabel(reportPreviousRange(report))}{" "}
                      · 作成 {formatDateTime(report.generatedAt)}
                    </summary>
                    <div className="dashboard-report-grid">
                      <span>
                        PV {number(ga4?.metrics["pageViews"])}（前{" "}
                        {number(reportPreviousSource(report, "ga4")?.metrics["pageViews"])}） ·{" "}
                        {ga4?.coveredDays ?? 0}/{ga4?.expectedDays ?? 0}日
                      </span>
                      <span>
                        検索表示 {number(gsc?.metrics["impressions"])}（前{" "}
                        {number(reportPreviousSource(report, "gsc_site")?.metrics["impressions"])}）
                        · {gsc?.coveredDays ?? 0}/{gsc?.expectedDays ?? 0}日
                      </span>
                      <span>
                        クリック {number(gsc?.metrics["clicks"])}（前{" "}
                        {number(reportPreviousSource(report, "gsc_site")?.metrics["clicks"])}） ·
                        CTR {percent(gsc?.metrics["ctr"])}（前{" "}
                        {percent(reportPreviousSource(report, "gsc_site")?.metrics["ctr"])}）
                      </span>
                      <span>
                        平均順位 {number(gsc?.metrics["position"], 1)}（前{" "}
                        {number(reportPreviousSource(report, "gsc_site")?.metrics["position"], 1)}）
                      </span>
                      <span>
                        AdSense推定{" "}
                        {ads?.metrics["estimatedEarningsJPY"] == null
                          ? "未取得"
                          : `¥${number(ads.metrics["estimatedEarningsJPY"])}`}
                        （前{" "}
                        {reportPreviousSource(report, "adsense")?.metrics["estimatedEarningsJPY"] ==
                        null
                          ? "未取得"
                          : `¥${number(reportPreviousSource(report, "adsense")?.metrics["estimatedEarningsJPY"])}`}
                        ）
                      </span>
                      <span>
                        読者体験{" "}
                        {report.experience?.current.length
                          ? `${report.experience.current.length} cohort`
                          : "未取得"}
                      </span>
                    </div>
                    <p className="dashboard-note">
                      保存時点の値です。最新再集計で上書きしていません。AI解釈文の本文はレポートDTOに含まれないため、数値のみを表示します。
                    </p>
                  </details>
                );
              })}
          </div>
        )}
      </Panel>

      <h2 className="dashboard-section-heading">サイト運用・問い合わせ・公開状況</h2>
      <div className="stats">
        <Stat
          label="未対応のお問い合わせ"
          value={inquiries.data?.open?.total}
          loading={inquiries.loading}
          href={href.inquiries()}
          tone={inquiries.data?.open?.total ? "accent" : "neutral"}
        />
        <Stat
          label="公開中の記事数"
          value={articles.data ? operationalCounts(is("live", "changed")) : undefined}
          loading={articles.loading}
          href={href.articles()}
        />
        <Stat
          label="未公開変更"
          value={articles.data ? operationalCounts(is("changed")) : undefined}
          loading={articles.loading}
          href={href.articles()}
        />
        <Stat
          label="下書き"
          value={articles.data ? operationalCounts(is("draft", "withdrawn")) : undefined}
          loading={articles.loading}
          href={href.articles()}
        />
        <Stat
          label="予約公開"
          value={articles.data ? operationalCounts(is("scheduled")) : undefined}
          loading={articles.loading}
          href={href.articles()}
        />
        <Stat
          label="URL整合性の問題"
          value={integrity.data?.problems.length}
          loading={integrity.loading}
          href={href.routes()}
          tone={integrity.data?.problems.length ? "danger" : "neutral"}
        />
      </div>
      <div className="dashboard-grid dashboard-grid--main">
        <Panel title="未対応のお問い合わせ" actions={<a href={href.inquiries()}>すべて →</a>}>
          {inquiries.error ? (
            <ErrorState error={inquiries.error} onRetry={() => void inquiries.reload()} />
          ) : inquiries.loading ? (
            <SkeletonRows rows={4} />
          ) : !inquiries.data?.status.configured ? (
            <EmptyState>共通お問い合わせ基盤への接続が未設定です。</EmptyState>
          ) : !inquiries.data.status.registered ? (
            <EmptyState>このサイトが基盤に登録されていません。</EmptyState>
          ) : inquiries.data.open?.items.length === 0 ? (
            <EmptyState>未対応はありません。</EmptyState>
          ) : (
            <ul className="rows">
              {inquiries.data.open?.items.slice(0, 6).map((ticket) => (
                <li key={ticket.id}>
                  <a href={href.inquiry(ticket.id)} className="rows__main">
                    {ticket.subject}
                  </a>
                  <Badge tone={ticket.status === "NEW" ? "accent" : "neutral"}>
                    {ticketStatusLabels[ticket.status]}
                  </Badge>
                  <span className="muted">{formatRelative(ticket.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="まだ公開していないもの" actions={<a href={href.articles()}>記事一覧 →</a>}>
          {articles.error ? (
            <ErrorState error={articles.error} onRetry={() => void articles.reload()} />
          ) : articles.loading ? (
            <SkeletonRows rows={4} />
          ) : pending.length === 0 ? (
            <EmptyState>公開していない下書き・変更はありません。</EmptyState>
          ) : (
            <ul className="rows">
              {pending.map((item) => (
                <li key={item.id}>
                  <a href={href.article(item.id)} className="rows__main">
                    {titleFor(item)}
                  </a>
                  <PhaseBadge article={item} />
                  <span className="muted">{formatRelative(item.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {scheduled.length > 0 && (
          <Panel title="予約公開">
            <ul className="rows">
              {scheduled.map((item) => (
                <li key={item.id}>
                  <a href={href.article(item.id)} className="rows__main">
                    {titleFor(item)}
                  </a>
                  <span className="muted">
                    {formatDateTime(item.scheduledAt ?? item.publishedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {integrity.error !== undefined && (
          <Panel title="URLの問題">
            <ErrorState error={integrity.error} onRetry={() => void integrity.reload()} />
          </Panel>
        )}
        {integrity.data && integrity.data.problems.length > 0 && (
          <Panel title="URLの問題" actions={<a href={href.routes()}>URL管理 →</a>}>
            <ul className="problems">
              {integrity.data.problems.slice(0, 6).map((problem) => (
                <li key={`${problem.code}-${problem.target ?? ""}`}>{problem.message}</li>
              ))}
            </ul>
          </Panel>
        )}
        {integrity.data && integrity.data.problems.length === 0 && (
          <Panel title="URL整合性">
            <EmptyState>URLの問題はありません。</EmptyState>
          </Panel>
        )}
      </div>
      <p className="dashboard-note">
        このホームは管理APIの認証済みデータのみを表示します。各パネルは個別に読み込み・再試行できます。
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  href: link,
  tone = "neutral",
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  href: string;
  tone?: "neutral" | "accent" | "danger";
}) {
  return (
    <a className={`stat stat--${tone}`} href={link}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value !== undefined ? value : loading ? <span className="skeleton skeleton--num" /> : "—"}
      </span>
    </a>
  );
}
