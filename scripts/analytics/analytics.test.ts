import { describe, expect, it } from "vitest";
import { assertAnalyticsDay } from "@tomokichi/contracts";
import { dateRange } from "@tomokichi/application";
import { buildDays } from "./collect.js";
import { queryConfig } from "./bigquery.js";
const range = dateRange("2026-10-01", "2026-10-02");
const now = "2026-10-05T00:00:00Z";
describe("collection quality boundary", () => {
  it("rejects duplicate grain keys, nonfinite metrics, invalid days and oversized private data", () => {
    const day = buildDays("ga4", range, ["2026-10-01"], [], [], now)[0]!;
    expect(() => assertAnalyticsDay({ ...day, rows: [...day.rows, ...day.rows] })).toThrow(
      "DUPLICATE",
    );
    expect(() => assertAnalyticsDay({ ...day, date: "2026-02-30" })).toThrow();
    expect(() =>
      assertAnalyticsDay({ ...day, rows: [{ ...day.rows[0], metrics: { users: Infinity } }] }),
    ).toThrow();
    expect(() =>
      assertAnalyticsDay({
        ...day,
        rows: [{ ...day.rows[0], metrics: { users: 9007199254740992 } }],
      }),
    ).toThrow();
    expect(() =>
      assertAnalyticsDay({
        ...day,
        rows: [{ ...day.rows[0], metrics: { clicks: 5, impressions: 1 } }],
      }),
    ).toThrow();
    expect(() =>
      assertAnalyticsDay({
        ...day,
        rows: Array.from({ length: 1000 }, (_, i) => ({
          ...day.rows[0],
          key: `${i}`.padEnd(1000, "a"),
        })),
      }),
    ).toThrow("TOO_LARGE");
  });
  it("parameterizes dates/property; rejects malicious range before SQL; excludes intraday", () => {
    const config = queryConfig("ga4", range);
    expect(config.queryParameters).toContainEqual({
      name: "start",
      parameterType: { type: "STRING" },
      parameterValue: { value: range.start },
    });
    expect(config.query).toContain("_TABLE_SUFFIX BETWEEN");
    expect(config.query).toContain("r'^\\d{8}$'");
    expect(config.maximumBytesBilled).toBe("1000000000");
    expect(() => queryConfig("ga4", { start: "2026-10-01' OR TRUE--", end: range.end })).toThrow();
  });
});
