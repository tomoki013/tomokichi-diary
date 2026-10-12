import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assertAnalyticsDay } from "@tomokichi/contracts";
import { dateRange, type AnalyticsDay } from "@tomokichi/application";
import { fromNodeSqlite, openInMemoryDatabase } from "../node-sqlite.js";
import { analyticsReplacement, createAnalyticsStore } from "../analytics.js";
const now = "2026-10-13T00:00:00Z";
const day = (date: string, views: number): AnalyticsDay => ({
  source: "ga4",
  date,
  retrievedAt: now,
  provisional: false,
  rows: [
    {
      grain: "site",
      key: "",
      path: null,
      articleId: null,
      metrics: { pageViews: views, users: 1 },
    },
  ],
});
describe("atomic private storage", () => {
  it("replaces replayed/late days without duplicates; backfill preserves later history and last watermark", async () => {
    const db = fromNodeSqlite(openInMemoryDatabase());
    await db.exec(readFileSync("migrations/0015_analytics.sql", "utf8"));
    const store = createAnalyticsStore(db);
    const save = async (days: AnalyticsDay[]) => {
      days.forEach(assertAnalyticsDay);
      const range = dateRange(days[0]!.date, days.at(-1)!.date);
      await db.batch(
        analyticsReplacement("ga4", range, days, now).map((s) =>
          db.prepare(s.sql).bind(...s.params),
        ),
      );
    };
    await save([day("2026-10-10", 10)]);
    await save([day("2026-10-10", 12)]);
    await save([day("2026-10-01", 5)]);
    const saved = await store.read(dateRange("2026-10-01", "2026-10-10"));
    expect(saved).toHaveLength(2);
    expect(saved[1]?.rows[0]?.metrics["pageViews"]).toBe(12);
    expect((await store.statuses())[0]?.latestDate).toBe("2026-10-10");
    const invalid = analyticsReplacement(
      "ga4",
      dateRange("2026-10-10", "2026-10-10"),
      [day("2026-10-10", 999)],
      now,
    ).map((s) => db.prepare(s.sql).bind(...s.params));
    invalid.push(
      db
        .prepare("INSERT INTO analytics_days VALUES(?,?,?)")
        .bind("ga4", "2026-10-11", "invalid JSON"),
    );
    await expect(db.batch(invalid)).rejects.toThrow();
    expect(
      (await store.read(dateRange("2026-10-10", "2026-10-10")))[0]?.rows[0]?.metrics["pageViews"],
    ).toBe(12);
  });
});
