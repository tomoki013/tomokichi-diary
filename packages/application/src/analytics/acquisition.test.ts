import { describe, expect, it } from "vitest";
import { acquisition, classifyChannel, factsOf, type EntryKey } from "./acquisition.js";
import type { AnalyticsDay, AnalyticsRow } from "./model.js";

const key = (referrer: string, extra: Partial<EntryKey> = {}): EntryKey => ({
  referrer,
  source: "",
  medium: "",
  visitor: "new",
  ...extra,
});
const entry = (
  from: EntryKey,
  entrances: number,
  articleId: string | null = "a",
  path = "/posts/a",
): AnalyticsRow => ({
  grain: "entry",
  key: JSON.stringify(from),
  path,
  articleId,
  metrics: { entrances, engagedEntrances: entrances, entryPageViews: entrances * 2 },
});
const day = (source: AnalyticsDay["source"], date: string, rows: AnalyticsRow[]): AnalyticsDay => ({
  source,
  date,
  retrievedAt: `${date}T00:00:00Z`,
  provisional: false,
  rows,
});

describe("channel of a visit", () => {
  it("reads search, AI assistants, social, mail, own pages and plain links from the referrer", () => {
    expect(classifyChannel(key(""))).toBe("direct");
    expect(classifyChannel(key("www.google.co.jp"))).toBe("organic_search");
    expect(classifyChannel(key("search.yahoo.co.jp"))).toBe("organic_search");
    expect(classifyChannel(key("com.google.android.googlequicksearchbox"))).toBe("organic_search");
    expect(classifyChannel(key("gemini.google.com"))).toBe("ai_assistant");
    expect(classifyChannel(key("chatgpt.com"))).toBe("ai_assistant");
    expect(classifyChannel(key("t.co"))).toBe("social");
    expect(classifyChannel(key("jp.pinterest.com"))).toBe("social");
    expect(classifyChannel(key("mail.google.com"))).toBe("email");
    expect(classifyChannel(key("www.tomokichidiary.com"))).toBe("internal");
    expect(classifyChannel(key("news.google.com"))).toBe("referral");
    expect(classifyChannel(key("notgoogle.com"))).toBe("referral");
  });
  it("lets a utm tag on the landing address win over the referrer", () => {
    expect(classifyChannel(key("t.co", { source: "newsletter", medium: "email" }))).toBe("email");
    expect(classifyChannel(key("", { source: "x", medium: "" }))).toBe("social");
    expect(classifyChannel(key("", { source: "chatgpt.com", medium: "" }))).toBe("ai_assistant");
    expect(classifyChannel(key("", { source: "partner", medium: "banner" }))).toBe("campaign");
  });
});

describe("visits for a period", () => {
  const days = [
    day("ga4", "2026-10-10", [
      entry(key("www.google.com"), 10),
      entry(key("www.google.com", { visitor: "returning" }), 4),
      entry(key("chatgpt.com"), 3, null, "/"),
    ]),
    day("ga4", "2026-10-11", [entry(key("www.google.com"), 5)]),
    day("ga4", "2026-10-12", [
      { grain: "site", key: "", path: null, articleId: null, metrics: { pageViews: 9 } },
    ]),
  ];
  const range = { start: "2026-10-10", end: "2026-10-12" };
  it("groups by channel, referrer and landing page, and counts first visits", () => {
    const result = acquisition(days, range)!;
    expect(result.coveredDays).toBe(2);
    expect(result.channels.map((row) => [row.key, row.metrics["entrances"]])).toEqual([
      ["organic_search", 19],
      ["ai_assistant", 3],
    ]);
    expect(result.channels[0]!.metrics["newEntrances"]).toBe(15);
    expect(result.referrers[0]).toMatchObject({ key: "www.google.com" });
    expect(result.landings[0]).toMatchObject({ articleId: "a", path: "/posts/a" });
    expect(acquisition(days, range, "a")!.channels).toHaveLength(1);
  });
  it("is null, not zero, where visits were not measured", () => {
    expect(acquisition(days, { start: "2026-10-12", end: "2026-10-12" })).toBeNull();
  });
});

describe("lines for the trend table", () => {
  it("keeps site, channel and article sums, and leaves unmeasured numbers null", () => {
    const facts = factsOf(
      day("ga4", "2026-10-10", [
        {
          grain: "site",
          key: "",
          path: null,
          articleId: null,
          metrics: { pageViews: 50, users: 20 },
        },
        {
          grain: "page",
          key: "/posts/a",
          path: "/posts/a",
          articleId: "a",
          metrics: { pageViews: 30 },
        },
        { grain: "page", key: "/", path: "/", articleId: null, metrics: { pageViews: 20 } },
        entry(key("www.google.com"), 10),
        entry(key("", { visitor: "returning" }), 2, null, "/"),
      ]),
    );
    const find = (grain: string, k: string) => facts.find((f) => f.grain === grain && f.key === k)!;
    expect(find("site", "")).toMatchObject({
      pageViews: 50,
      entrances: 12,
      newEntrances: 10,
      clicks: null,
    });
    expect(find("channel", "organic_search").entrances).toBe(10);
    expect(find("channel", "direct")).toMatchObject({ entrances: 2, newEntrances: 0 });
    expect(find("article", "a")).toMatchObject({ pageViews: 30, entrances: 10 });
    const old = factsOf(
      day("ga4", "2026-09-01", [
        { grain: "site", key: "", path: null, articleId: null, metrics: { pageViews: 7 } },
      ]),
    );
    expect(old).toEqual([expect.objectContaining({ pageViews: 7, entrances: null })]);
  });
  it("takes search from Search Console and earnings from AdSense", () => {
    const search = { clicks: 3, impressions: 30, positionSum: 60 };
    expect(
      factsOf(
        day("gsc_site", "2026-10-10", [
          { grain: "site", key: "", path: null, articleId: null, metrics: search },
          { grain: "search_type", key: "DISCOVER", path: null, articleId: null, metrics: search },
          { grain: "country", key: "jpn", path: null, articleId: null, metrics: search },
        ]),
      ).map((f) => [f.grain, f.key, f.clicks]),
    ).toEqual([
      ["site", "", 3],
      ["search_type", "DISCOVER", 3],
    ]);
    expect(
      factsOf(
        day("gsc_url", "2026-10-10", [
          { grain: "page", key: "/posts/a", path: "/posts/a", articleId: "a", metrics: search },
          { grain: "page", key: "/posts/old", path: "/posts/old", articleId: "a", metrics: search },
          { grain: "query", key: "q", path: "/posts/a", articleId: "a", metrics: search },
        ]),
      ),
    ).toEqual([
      expect.objectContaining({ grain: "article", key: "a", clicks: 6, positionSum: 120 }),
    ]);
    expect(
      factsOf(
        day("adsense", "2026-10-10", [
          {
            grain: "site",
            key: "",
            path: null,
            articleId: null,
            metrics: { estimatedEarningsJPY: 12.5 },
          },
        ]),
      )[0],
    ).toMatchObject({ earningsJPY: 12.5, pageViews: null });
  });
});
