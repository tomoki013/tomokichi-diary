import { ANALYTICS_SECTIONS, type AnalyticsDashboardDto } from "../analytics.js";
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
      "分析の根拠を詳しく調べるときに使います。両日を含む93日以内の期間、任意の記事IDについて流入・検索・広告収益・読書体験・取得状況・前期間比較を返します。sections で必要な部分だけに絞れます。記事を指定すると scope が article になり、検索は gsc_url に入って gsc_site は null です。生の訪問者ID、秘密、問い合わせは返しません。",
    tool: { name: "get_analytics_dashboard", title: "期間・記事別の非公開集計" },
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
