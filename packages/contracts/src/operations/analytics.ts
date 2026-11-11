import {
  ANALYTICS_SECTIONS,
  type AnalyticsDashboardDto,
  type AnalyticsListPageDto,
} from "../analytics.js";
import { v } from "../validation.js";
import { plainDate } from "./fields.js";
import { operation } from "./spec.js";

const target = { type: "analytics" } as const;

export interface AnalyticsRangeDto {
  readonly start: string;
  readonly end: string;
}
export interface AnalyticsReportResultDto {
  readonly period: "weekly" | "monthly";
  readonly range: AnalyticsRangeDto;
  readonly timeZone: "Asia/Tokyo";
  readonly generatedAt: string;
  /**
   * The report saved when the period closed. Its contents (`data`) come only
   * with includeSnapshot: the current numbers are in `dashboard`.
   */
  readonly snapshot: {
    readonly state: "saved" | "not_generated";
    readonly generatedAt: string | null;
    readonly data?: unknown;
  };
  readonly dashboard: AnalyticsDashboardDto;
}
export interface AnalyticsDashboardResultDto {
  readonly generatedAt: string;
  readonly timeZone: "Asia/Tokyo";
  readonly dashboard: AnalyticsDashboardDto;
}
export const TREND_GRAINS = ["site", "channel", "article", "search_type"] as const;
export interface AnalyticsTrendSeriesDto {
  /** "" for the site, a channel name, a search type or an article id. */
  readonly key: string;
  /** For articles: the published title, path and first publication time. */
  readonly title?: string | null;
  readonly path?: string | null;
  readonly publishedAt?: string | null;
  /** Sums over the two halves in `compared`, to rank what fell or grew. */
  readonly compared?: {
    readonly pageViews: { readonly earlier: number | null; readonly recent: number | null };
    readonly clicks: { readonly earlier: number | null; readonly recent: number | null };
  };
  /** One array per metric, aligned with `buckets`. null = not collected, never 0. */
  readonly values: Readonly<Record<string, readonly (number | null)[]>>;
}
export interface AnalyticsTrendResultDto {
  readonly generatedAt: string;
  readonly range: AnalyticsRangeDto;
  readonly bucket: "week" | "month";
  readonly by: (typeof TREND_GRAINS)[number];
  /** `complete` is false when the range cuts the week or month short. */
  readonly buckets: readonly {
    readonly start: string;
    readonly end: string;
    readonly days: number;
    readonly complete: boolean;
  }[];
  /** Collected days per source in each bucket; fewer than `days` means a gap, not a fall. */
  readonly coverage: readonly { readonly source: string; readonly days: readonly number[] }[];
  readonly compared: {
    readonly earlier: AnalyticsRangeDto;
    readonly recent: AnalyticsRangeDto;
  } | null;
  readonly series: readonly AnalyticsTrendSeriesDto[];
  readonly list: AnalyticsListPageDto | null;
  /** Site only: articles first published in each bucket (Japan time). */
  readonly published?: readonly number[];
  readonly notes: readonly string[];
}

/** One saved report, without its contents (read them with analytics.report). */
export interface SavedReportDto {
  readonly period: "weekly" | "monthly";
  readonly start: string;
  readonly end: string;
  readonly generatedAt: string;
}

const sectionList = ANALYTICS_SECTIONS.join("・");
/** What to return; shared by the report and the dashboard. */
const shape = {
  sections: v.describe(
    v.maybe(v.array(v.literalUnion(ANALYTICS_SECTIONS), { max: ANALYTICS_SECTIONS.length })),
    `返す部分（${sectionList}）。主要指標（current・previous）と取得状況は常に返す。省略時は experiments 以外すべて。主要指標だけなら [] を渡す`,
  ),
  limit: v.describe(
    v.maybe(v.number({ min: 1, max: 100, integer: true })),
    "一覧（記事・ページ・検索クエリ・内訳・実験）ごとの最大件数。省略時は20。全件数は lists に入る",
  ),
  offset: v.describe(
    v.maybe(v.number({ min: 0, max: 10000, integer: true })),
    "一覧の何件目から返すか（次のページを読むとき）。省略時は0",
  ),
};

export const analyticsOperations = {
  "analytics.report": operation<AnalyticsReportResultDto>()({
    kind: "read",
    surface: "analytics",
    input: v.object({
      period: v.literalUnion(["weekly", "monthly"] as const),
      start: v.describe(
        v.maybe(plainDate),
        "過去の週（月曜日）または月（1日）を読むときの開始日。省略時は完了した直近の週・月。保存済みの期間は list_analytics_reports で分かる",
      ),
      ...shape,
      includeSnapshot: v.describe(
        v.maybe(v.boolean()),
        "期間終了時に保存したレポートの中身も返す（集計の後追い修正を確かめるときだけ）。省略時は返さない",
      ),
    }),
    description:
      "週次/月次分析や定期分析をするときに使います。完了した週（月〜日）または月の最新集計と前期間比較を返します。sections で必要な部分だけに絞れます。データの無い取得元は null、一覧が limit で切れたときは lists に全件数が入ります。広告・記事の変更はできません。",
    tool: { name: "get_analytics_report", title: "週次・月次の非公開分析データ" },
    target,
  }),
  "analytics.dashboard": operation<AnalyticsDashboardResultDto>()({
    kind: "read",
    surface: "analytics",
    input: v.object({
      start: plainDate,
      end: plainDate,
      articleId: v.maybe(v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9_-]{1,100}$/ })),
      ...shape,
    }),
    description:
      "分析の根拠を詳しく調べるときに使います。両日を含む93日以内の期間、任意の記事IDについて流入・検索・広告収益・読書体験・取得状況・前期間比較を返します。acquisition は訪問を流入経路（検索・AI・SNS・直接など）・参照元・入口ページ別に分けたものです。sections で必要な部分だけに絞れます。記事を指定すると scope が article になり、検索は gsc_url に入って gsc_site は null です。生の訪問者ID、秘密、問い合わせは返しません。",
    tool: { name: "get_analytics_dashboard", title: "期間・記事別の非公開集計" },
    target,
  }),
  "analytics.trend": operation<AnalyticsTrendResultDto>()({
    kind: "read",
    surface: "analytics",
    input: v.object({
      start: plainDate,
      end: plainDate,
      bucket: v.describe(
        v.maybe(v.literalUnion(["week", "month"] as const)),
        "週（月曜始まり）か月でまとめる。省略時は week",
      ),
      by: v.describe(
        v.maybe(v.literalUnion(TREND_GRAINS)),
        "何ごとの推移か。site（全体）・channel（流入経路）・article（記事）・search_type（Google の web/discover/image など）。省略時は site",
      ),
      key: v.describe(
        v.maybe(v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9_-]{1,100}$/ })),
        "1本だけ見るときの記事ID・経路名・検索種別",
      ),
      sort: v.describe(
        v.maybe(v.literalUnion(["total", "decline", "growth"] as const)),
        "並び順。total は期間合計、decline は落ち幅の大きい順、growth は伸び幅の大きい順（compared の前半と後半の差）。省略時は total",
      ),
      limit: v.describe(
        v.maybe(v.number({ min: 1, max: 100, integer: true })),
        "返す本数（記事・経路）。省略時は20",
      ),
      offset: v.describe(
        v.maybe(v.number({ min: 0, max: 10000, integer: true })),
        "何本目から返すか",
      ),
    }),
    description:
      "長い目で増減を見るときに使います。最長800日を週または月にまとめ、全体・流入経路別・記事別・検索種別の PV・訪問（入口）・検索クリック/表示/順位・推定収益の推移を返します。下がっているのがどの経路・どの記事かを sort: decline で探せます。値は buckets と同じ並びの配列で、未取得は null（0 ではない）。coverage の日数が少ない週は欠けであって減少ではありません。人数（ユーザー）は日をまたいで足せないのでここには無く、get_analytics_dashboard で読みます。",
    tool: { name: "get_analytics_trend", title: "長期の推移（週・月）" },
    target,
  }),
  "analytics.savedReports": operation<{ items: readonly SavedReportDto[] }>()({
    kind: "read",
    surface: "analytics",
    input: v.object({}),
    description:
      "保存済みの週次・月次レポートの一覧（期間と保存日時だけ）を新しい順に12件まで返します。中身は get_analytics_report に period と start を渡して読みます。",
    tool: { name: "list_analytics_reports", title: "保存済みの分析レポート" },
    target,
  }),
  "analytics.recollect": operation<{
    state: "queued";
    start: string;
    end: string;
    url: string;
  }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      start: plainDate,
      end: plainDate,
      scope: v.describe(
        v.literalUnion(["all", "counts"] as const),
        "all は全指標の再集計（31日以内）、counts は期間人数だけ（93日以内）",
      ),
    }),
    description:
      "分析データの再集計を起動します（GitHub Actions で実行され、数分かかります）。集計が抜けている期間があるときに使います。",
    tool: { name: "recollect_analytics", title: "Recollect analytics" },
    target,
  }),
};
