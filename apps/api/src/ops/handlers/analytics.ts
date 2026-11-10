import {
  analyticsDashboard,
  completedRange,
  dateRange,
  shiftDate,
  type DashboardSection,
} from "@tomokichi/application";
import type { AnalyticsDashboardDto } from "@tomokichi/contracts";
import { createAnalyticsStore } from "@tomokichi/infra-d1";
import { OpError, type Handlers, type OpScope } from "../scope.js";

type Names =
  "analytics.report" | "analytics.dashboard" | "analytics.savedReports" | "analytics.recollect";

function rangeOf(start: string, end: string, maxDays: number, message: string) {
  try {
    return dateRange(start, end, maxDays);
  } catch {
    throw new OpError("ANALYTICS_INVALID_RANGE", message, 400);
  }
}

interface Shape {
  sections?: readonly DashboardSection[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

const dashboard = (
  scope: OpScope,
  range: ReturnType<typeof dateRange>,
  articleId: string | undefined,
  { sections, limit, offset }: Shape,
) =>
  analyticsDashboard(createAnalyticsStore(scope.db()), range, articleId, {
    ...(sections ? { sections } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  }) as unknown as Promise<AnalyticsDashboardDto>;

/** A completed week (Monday–Sunday) or month starting on `start`, or the latest one. */
function reportRange(period: "weekly" | "monthly", start: string | undefined) {
  const latest = completedRange(period);
  if (start === undefined) return latest;
  const invalid = () =>
    new OpError(
      "ANALYTICS_INVALID_RANGE",
      period === "weekly"
        ? "週次の start は完了した週の月曜日にしてください"
        : "月次の start は完了した月の1日にしてください",
      400,
    );
  let end: string;
  try {
    if (period === "weekly") {
      if (new Date(`${start}T00:00:00Z`).getUTCDay() !== 1) throw invalid();
      end = shiftDate(start, 6);
    } else {
      if (!start.endsWith("-01")) throw invalid();
      end = shiftDate(`${shiftDate(start, 31).slice(0, 7)}-01`, -1);
    }
    if (end > latest.end) throw invalid();
    return dateRange(start, end);
  } catch (error) {
    throw error instanceof OpError ? error : invalid();
  }
}

export const analyticsHandlers: Handlers<Names> = {
  "analytics.report": async (scope, { period, start, includeSnapshot, ...shape }) => {
    const range = reportRange(period, start);
    const row = await scope
      .db()
      .prepare(
        "SELECT generated_at,payload FROM analytics_reports WHERE period=? AND start=? AND end=?",
      )
      .bind(period, range.start, range.end)
      .first<{ generated_at: string; payload: string }>();
    return {
      period,
      range,
      timeZone: "Asia/Tokyo",
      generatedAt: new Date().toISOString(),
      snapshot: {
        state: row ? "saved" : "not_generated",
        generatedAt: row?.generated_at ?? null,
        ...(row && includeSnapshot ? { data: JSON.parse(row.payload) as unknown } : {}),
      },
      dashboard: await dashboard(scope, range, undefined, shape),
    };
  },

  "analytics.dashboard": async (scope, { start, end, articleId, ...shape }) => ({
    generatedAt: new Date().toISOString(),
    timeZone: "Asia/Tokyo",
    dashboard: await dashboard(
      scope,
      rangeOf(start, end, 93, "期間は実在する日付で93日以内にしてください"),
      articleId,
      shape,
    ),
  }),

  // Only which reports exist: their contents are read one at a time, by period.
  "analytics.savedReports": async (scope) => {
    const rows = await scope
      .db()
      .prepare(
        "SELECT period,start,end,generated_at FROM analytics_reports ORDER BY generated_at DESC LIMIT 12",
      )
      .all<{ period: "weekly" | "monthly"; start: string; end: string; generated_at: string }>();
    return {
      items: rows.map((row) => ({
        period: row.period,
        start: row.start,
        end: row.end,
        generatedAt: row.generated_at,
      })),
    };
  },

  // Runs in GitHub Actions: the collectors hold the credentials, not this Worker.
  "analytics.recollect": async ({ env }, { start, end, scope: what }) => {
    const countsOnly = what === "counts";
    const range = rangeOf(
      start,
      end,
      countsOnly ? 93 : 31,
      countsOnly ? "期間人数は93日以内で指定してください" : "再集計は31日以内で指定してください",
    );
    const token = env.ANALYTICS_GITHUB_TOKEN?.trim();
    if (!token) throw new OpError("ANALYTICS_UNCONFIGURED", "再集計の認証設定が未完了です", 503);
    const workflow = countsOnly ? "analytics-periods.yml" : "analytics-collect.yml";
    const base = "github.com/repos/tomoki013/tomokichi-diary/actions/workflows";
    try {
      const response = await fetch(`https://api.${base}/${workflow}/dispatches`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "tomokichi-diary-api",
        },
        body: JSON.stringify({ ref: "main", inputs: { start: range.start, end: range.end } }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
    } catch {
      throw new OpError("ANALYTICS_DISPATCH_FAILED", "GitHubの再集計起動に失敗しました", 502);
    }
    return {
      state: "queued",
      start: range.start,
      end: range.end,
      url: `https://github.com/tomoki013/tomokichi-diary/actions/workflows/${workflow}`,
    };
  },
};
