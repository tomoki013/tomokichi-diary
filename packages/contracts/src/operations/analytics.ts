import type { AnalyticsDashboardDto } from "../analytics.js";
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
  readonly savedReport: { generatedAt: string; data: unknown } | null;
  readonly snapshotState: "saved" | "not_generated";
  readonly latest: AnalyticsDashboardDto;
}
export interface AnalyticsDashboardResultDto {
  readonly generatedAt: string;
  readonly timeZone: "Asia/Tokyo";
  readonly dashboard: AnalyticsDashboardDto;
}
export interface SavedReportDto {
  readonly period: string;
  readonly start: string;
  readonly end: string;
  readonly generatedAt: string;
  readonly [key: string]: unknown;
}

export const analyticsOperations = {
  "analytics.report": operation<AnalyticsReportResultDto>()({
    kind: "read",
    surface: "analytics",
    input: v.object({ period: v.literalUnion(["weekly", "monthly"] as const) }),
    description:
      "週次/月次分析や定期分析をするときに使います。完了した直近の週（月〜日）または前月の保存レポートと最新集計・前期間比較を返します。保存レポートの未生成・データ不足・推定値は明示します。広告・記事の変更はできません。",
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
    }),
    description:
      "分析の根拠を詳しく調べるときに使います。両日を含む93日以内の期間、任意の記事IDについて流入・検索・広告収益・読書体験・取得状況・前期間比較を返します。生の訪問者ID、秘密、問い合わせは返しません。",
    tool: { name: "get_analytics_dashboard", title: "期間・記事別の非公開集計" },
    target,
  }),
  "analytics.savedReports": operation<{ items: readonly SavedReportDto[] }>()({
    kind: "read",
    surface: "analytics",
    input: v.object({}),
    description: "保存済みの週次・月次レポートを新しい順に12件まで返します。",
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
