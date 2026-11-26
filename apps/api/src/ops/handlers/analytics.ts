import {
  analyticsTrend,
  analyticsView,
  bucketStart,
  completedRange,
  dateRange,
  shiftDate,
  TREND_MAX_DAYS,
} from "@tomokichi/application";
import {
  analyticsAffiliateHosts,
  analyticsArticleLabels,
  createAnalyticsStore,
} from "@tomokichi/infra-d1";
import { OpError, type Handlers, type OpScope } from "../scope.js";

type Names =
  | "analytics.report"
  | "analytics.dashboard"
  | "analytics.trend"
  | "analytics.savedReports"
  | "analytics.recollect";

const TREND_NOTES = [
  "日付は GA4・Search Console とも米国太平洋時間。日本時間とは16〜17時間ずれる",
  "entrances は訪問（セッション）を開始日に1回だけ数えたもの。日・週で足せる",
  "channel の organic_search には Google Discover も入る。Discover だけは by: search_type で分かれる",
  "記事の entrances はその記事から訪問が始まった回数、pageViews は途中で読まれた分も含む",
  "直近4日は暫定値。complete が false の週・月は途中までの合計",
];

function rangeOf(start: string, end: string, maxDays: number, message: string) {
  try {
    return dateRange(start, end, maxDays);
  } catch {
    throw new OpError("ANALYTICS_INVALID_RANGE", message, 400);
  }
}

interface Paging {
  limit?: number | undefined;
  offset?: number | undefined;
}

/** The one view, with articles named and affiliate clicks told apart; the same for the admin and ChatGPT. */
function view(
  scope: OpScope,
  range: ReturnType<typeof dateRange>,
  articleId: string | undefined,
  { limit, offset }: Paging,
) {
  const db = scope.db();
  return analyticsView(createAnalyticsStore(db), range, articleId, {
    labels: (ids) => analyticsArticleLabels(db, ids),
    affiliateHosts: () => analyticsAffiliateHosts(db),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  });
}

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
  "analytics.report": async (scope, { period, start, ...paging }) => {
    const range = reportRange(period, start);
    const row = await scope
      .db()
      .prepare("SELECT generated_at FROM analytics_reports WHERE period=? AND start=? AND end=?")
      .bind(period, range.start, range.end)
      .first<{ generated_at: string }>();
    return {
      period,
      range,
      timeZone: "Asia/Tokyo",
      generatedAt: new Date().toISOString(),
      snapshot: {
        state: row ? "saved" : "not_generated",
        generatedAt: row?.generated_at ?? null,
      },
      dashboard: await view(scope, range, undefined, paging),
    };
  },

  "analytics.dashboard": async (scope, { start, end, articleId, ...paging }) => ({
    generatedAt: new Date().toISOString(),
    timeZone: "Asia/Tokyo",
    dashboard: await view(
      scope,
      rangeOf(start, end, 93, "期間は実在する日付で93日以内にしてください"),
      articleId,
      paging,
    ),
  }),

  "analytics.trend": async (scope, { start, end, bucket = "week", by = "site", ...rest }) => {
    const range = rangeOf(
      start,
      end,
      TREND_MAX_DAYS,
      `期間は実在する日付で${TREND_MAX_DAYS}日以内にしてください`,
    );
    const trend = await analyticsTrend(createAnalyticsStore(scope.db()), range, {
      bucket,
      by,
      ...(rest.key !== undefined ? { key: rest.key } : {}),
      ...(rest.sort !== undefined ? { sort: rest.sort } : {}),
      ...(rest.limit !== undefined ? { limit: rest.limit } : {}),
      ...(rest.offset !== undefined ? { offset: rest.offset } : {}),
    });
    const labels =
      by === "article"
        ? await analyticsArticleLabels(
            scope.db(),
            trend.series.map((line) => line.key),
          )
        : null;
    let published: number[] | undefined;
    if (by === "site") {
      // How much was written is the first thing to hold against a fall.
      const rows = await scope
        .db()
        .prepare(
          "SELECT published_at FROM articles WHERE status='published' AND published_at IS NOT NULL",
        )
        .all<{ published_at: string }>();
      const at = new Map(trend.buckets.map((b, i) => [b.start, i]));
      published = trend.buckets.map(() => 0);
      for (const row of rows) {
        const time = Date.parse(row.published_at);
        if (!Number.isFinite(time)) continue;
        const day = new Date(time).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
        if (day < range.start || day > range.end) continue;
        const slot = at.get(bucketStart(day, bucket));
        if (slot !== undefined) published[slot]! += 1;
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      ...trend,
      series: trend.series.map((line) => {
        const label = labels?.get(line.key);
        return label
          ? { ...line, title: label.title, path: label.path, publishedAt: label.publishedAt }
          : line;
      }),
      ...(published ? { published } : {}),
      notes: TREND_NOTES,
    };
  },

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
