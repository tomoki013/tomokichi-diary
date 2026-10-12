import { Hono } from "hono";
import { analyticsDashboard, dateRange } from "@tomokichi/application";
import { createAnalyticsStore, fromD1 } from "@tomokichi/infra-d1";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

export function analyticsRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => {
    await next();
    c.header("cache-control", "private, no-store");
    c.header("x-robots-tag", "noindex, nofollow");
  });
  routes.get("/", async (c) => {
    let range;
    try {
      range = dateRange(c.req.query("start") ?? "", c.req.query("end") ?? "");
    } catch {
      return errorResponse(
        c,
        "ANALYTICS_INVALID_RANGE",
        "期間は実在する日付で93日以内にしてください",
        400,
      );
    }
    const articleId = c.req.query("articleId");
    if (articleId && !/^[A-Za-z0-9_-]{1,100}$/.test(articleId))
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid article id", 400);
    return c.json(
      await analyticsDashboard(createAnalyticsStore(fromD1(c.env.DB)), range, articleId),
    );
  });
  routes.get("/reports", async (c) => {
    const rows = await fromD1(c.env.DB)
      .prepare(
        "SELECT period,start,end,generated_at,payload FROM analytics_reports ORDER BY generated_at DESC LIMIT 12",
      )
      .all<{ period: string; start: string; end: string; generated_at: string; payload: string }>();
    return c.json({
      items: rows.map((row) => ({
        period: row.period,
        start: row.start,
        end: row.end,
        generatedAt: row.generated_at,
        ...JSON.parse(row.payload),
      })),
    });
  });
  routes.post("/recalculate", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    let range;
    try {
      if (typeof body !== "object" || !body) throw new Error();
      const data = body as Record<string, unknown>;
      range = dateRange(String(data["start"] ?? ""), String(data["end"] ?? ""), 31);
    } catch {
      return errorResponse(c, "ANALYTICS_INVALID_RANGE", "再集計は31日以内で指定してください", 400);
    }
    if (!c.env.ANALYTICS_GITHUB_TOKEN?.trim())
      return errorResponse(c, "ANALYTICS_UNCONFIGURED", "再集計の認証設定が未完了です", 503);
    try {
      const response = await fetch(
        "https://api.github.com/repos/tomoki013/tomokichi-diary/actions/workflows/analytics-collect.yml/dispatches",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${c.env.ANALYTICS_GITHUB_TOKEN.trim()}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "tomokichi-diary-api",
          },
          body: JSON.stringify({ ref: "main", inputs: { start: range.start, end: range.end } }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw new Error();
      return c.json(
        {
          state: "queued",
          ...range,
          url: "https://github.com/tomoki013/tomokichi-diary/actions/workflows/analytics-collect.yml",
        },
        202,
      );
    } catch {
      return errorResponse(c, "ANALYTICS_DISPATCH_FAILED", "GitHubの再集計起動に失敗しました", 502);
    }
  });
  return routes;
}
