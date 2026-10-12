import { describe, expect, it, vi } from "vitest";
import { assertAnalyticsDay } from "@tomokichi/contracts";
import { dateRange } from "@tomokichi/application";
import { buildDays } from "./collect.js";
import { BigQuery, queryConfig } from "./bigquery.js";
import { AnalyticsHttpError, requestJson } from "./http.js";
import { adsenseUrl, fetchAdSense, parseAdSense } from "./adsense.js";
import { affiliateDays, type AffiliateRecord } from "./affiliate.js";
const range = dateRange("2026-10-01", "2026-10-02");
const now = "2026-10-05T00:00:00Z";
describe("collection quality boundary", () => {
  it("preserves numeric-looking search text; availability distinguishes zero and absent days", () => {
    const days = buildDays(
      "gsc_url",
      range,
      ["2026-10-01"],
      [
        {
          date: "2026-10-01",
          grain: "query",
          key: "123",
          path: "/a",
          clicks: "1",
          impressions: "2",
          positionSum: "5",
        },
      ],
      [],
      now,
    );
    expect(days).toHaveLength(1);
    expect(days[0]?.rows[0]?.key).toBe("123");
    expect(days[0]?.rows[0]?.metrics["clicks"]).toBe(1);
    const zero = buildDays("ga4", range, ["2026-10-01"], [], [], now);
    expect(zero[0]?.rows[0]?.metrics["pageViews"]).toBe(0);
    expect(() =>
      buildDays("ga4", range, [], [{ date: "2026-10-01", grain: "site", key: "" }], [], now),
    ).toThrow("INCONSISTENT");
  });
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
describe("HTTP recovery and permissions", () => {
  it("retries transient failures, preserving the idempotent request body", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(
      await requestJson(
        "https://example.test",
        { method: "POST", body: "same-job-id" },
        send,
        sleep,
      ),
    ).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every((c) => c[1].body === "same-job-id")).toBe(true);
  });
  it.each([401, 403])(
    "does not retry permission error %s or include response secrets",
    async (status) => {
      const send = vi.fn().mockResolvedValue(new Response("secret-value", { status }));
      const sleep = vi.fn();
      await expect(requestJson("https://example.test", {}, send, sleep)).rejects.toEqual(
        new AnalyticsHttpError(status),
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );
});
describe("optional revenue", () => {
  it("keeps AdSense disabled without credentials and never calls an API", async () => {
    vi.stubEnv("ADSENSE_ENABLED", "");
    expect(await fetchAdSense(range)).toBeNull();
    vi.unstubAllEnvs();
  });
  it("scopes AdSense reports to the blog and keeps estimated revenue separate", () => {
    const url = new URL(adsenseUrl("accounts/pub-123", range));
    expect(url.searchParams.get("filters")).toBe("OWNED_SITE_DOMAIN_NAME==tomokichidiary.com");
    const headers = ["DATE", "ESTIMATED_EARNINGS", "IMPRESSIONS", "PAGE_VIEWS", "CLICKS"].map(
      (name) => ({ name, ...(name === "ESTIMATED_EARNINGS" ? { currencyCode: "JPY" } : {}) }),
    );
    const report = {
      headers,
      totalMatchedRows: "1",
      rows: [{ cells: ["2026-10-01", "0", "100", "50", "1"].map((value) => ({ value })) }],
    };
    const output = parseAdSense(report, range, now);
    expect(output[0]?.rows[0]?.metrics).toMatchObject({ estimatedEarningsJPY: 0 });
    expect(output[0]?.provisional).toBe(true);
    expect(parseAdSense({ totalMatchedRows: "0" }, range, now)).toEqual([]);
    expect(() => parseAdSense({ ...report, totalMatchedRows: "2" }, range, now)).toThrow();
    expect(() => parseAdSense({ ...report, warnings: ["incomplete"] }, range, now)).toThrow();
  });
  it("imports real adapter records idempotently, rejects duplicates/currency mismatch", () => {
    const record: AffiliateRecord = {
      provider: "fixture",
      recordId: "1",
      date: "2026-10-01",
      campaignId: "c",
      url: null,
      currency: "JPY",
      clicks: 5,
      pendingConversions: 1,
      confirmedConversions: 2,
      pendingReward: 20,
      confirmedReward: 40,
    };
    const days = affiliateDays([record], [], now);
    expect(affiliateDays([record], [], now)).toEqual(days);
    expect(days[0]?.rows.find((r) => r.grain === "site")?.metrics).toMatchObject({
      confirmedConversions: 2,
      confirmedRewardJPY: 40,
    });
    expect(() => affiliateDays([record, record], [], now)).toThrow("DUPLICATE");
    expect(() =>
      affiliateDays([{ ...record, currency: "USD" } as unknown as AffiliateRecord], [], now),
    ).toThrow();
  });
});

describe("BigQuery job recovery", () => {
  it("recovers the same job after a duplicate submission and reads every paginated row", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jobReference: { jobId: "same" }, status: { state: "DONE" } }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schema: { fields: [{ name: "date" }] },
            totalRows: "2",
            rows: [{ f: [{ v: "2026-10-01" }] }],
            pageToken: "next",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totalRows: "2", rows: [{ f: [{ v: "2026-10-02" }] }] })),
      );
    vi.stubGlobal("fetch", send);
    try {
      expect(await new BigQuery("fixture-token").query("ga4_available", range)).toEqual([
        { date: "2026-10-01" },
        { date: "2026-10-02" },
      ]);
      const jobId = JSON.parse(send.mock.calls[0]![1].body).jobReference.jobId;
      expect(send.mock.calls[1]![0]).toContain(`/jobs/${jobId}`);
      expect(send.mock.calls[3]![0]).toContain("pageToken=next");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
