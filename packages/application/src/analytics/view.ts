import type {
  AnalyticsArticleLabel,
  AnalyticsArticleRowDto,
  AnalyticsCountRowDto,
  AnalyticsDailyDto,
  AnalyticsQueryRowDto,
  AnalyticsSourceStateDto,
  AnalyticsThemeDto,
  AnalyticsThemeRowDto,
  AnalyticsTotalsDto,
  AnalyticsViewDto,
} from "@tomokichi/contracts";
import { articleTheme, queryIntent } from "./classify.js";
import { anchorTestSummary, experienceKey } from "./experience.js";
import { classifyChannel, entryKey } from "./acquisition.js";
import {
  ANALYTICS_SOURCES,
  dates,
  previousRange,
  ratio,
  type AnalyticsDay,
  type AnalyticsRow,
  type AnalyticsStore,
  type DateRange,
} from "./model.js";

export type { AnalyticsArticleLabel };

/** A host an affiliate offer links to. Clicks to it count as affiliate clicks. */
export interface AffiliateHost {
  host: string;
  provider: string;
}
export interface ViewOptions {
  /** Rows per list (articles, queries). */
  readonly limit?: number;
  readonly offset?: number;
  /** Title, path, publication time and tags of the given articles. */
  readonly labels?: (ids: string[]) => Promise<Map<string, AnalyticsArticleLabel>>;
  readonly affiliateHosts?: () => Promise<readonly AffiliateHost[]>;
}

const NOTES = [
  "null は未取得で0ではない。sources の取得日数が足りない期間の増減は欠けを含む。",
  "users は期間全体の重複なし人数（GA4）。日別人数の合計ではない。記事指定時は null。",
  "検索は記事指定時と記事・テーマ別がURL単位（gsc_url）、サイト全体の totals だけがサイト単位（gsc_site）。CTRはクリック合計÷表示合計、順位は表示回数で重み付け。",
  "末尾到達率と次記事回遊率はreader-v1の計測表示数（measuredViews）が分母。導線の表示・導線を見た後のクリック率は計測していない。",
  "AdSenseの記事別はGoogleのページURL別推定。サイト合計との差は記事へ按分しない。アフィリエイトのクリックはGA4の外部リンククリックのうち登録案件のホスト宛て、報酬はASPレポートを取り込んだ日だけ。",
  "テーマの分類不明は、サイトPVからCHAGEE・非CHAGEE記事のPVを引いた残り（記事以外のページを含む）。検索意図の unknown を非CHAGEEに含めない。",
  "訪問（entrances）は訪問の始まりを開始ページで1回数えたもの。breakdowns.entryDays が0の期間は流入経路・参照元・入口が未取得。記事の devices はreader-v1計測の端末別。日別（daily）の人数は持たない。検索語と読者行動・流入元は個人単位で結合していない。",
];

const add = (a: number | null, b: number | null | undefined) => (b == null ? a : (a ?? 0) + b);
const inRange = (date: string, r: DateRange) => date >= r.start && date <= r.end;

/** Search sums whose CTR and position are worked out once, from totals. */
class Search {
  clicks: number | null = null;
  impressions: number | null = null;
  positionSum: number | null = null;
  add(m: AnalyticsRow["metrics"]) {
    this.clicks = add(this.clicks, m["clicks"]);
    this.impressions = add(this.impressions, m["impressions"]);
    this.positionSum = add(this.positionSum, m["positionSum"]);
  }
  get ctr() {
    return this.clicks == null ? null : ratio(this.clicks, this.impressions ?? 0);
  }
  get position() {
    const mean = this.positionSum == null ? null : ratio(this.positionSum, this.impressions ?? 0);
    return mean == null ? null : mean + 1;
  }
}

/** Everything one period says about one article. */
class Reading {
  pageViews: number | null = null;
  search = new Search();
  views = 0;
  ends = 0;
  next = 0;
  areas: Record<string, number> = {};
  adsense: number | null = null;
  affiliateClicks: number | null = null;
  rewards: number | null = null;
  body75 = 0;
  visibleMs: number | null = null;
  devices: Record<string, { views: number; ends: number; next: number }> = {};
  entrances: number | null = null;
  channels: Record<string, number> = {};
}
/** Adds n under key, creating it. */
const bump = (map: Map<string, number>, key: string, n: number | null | undefined) => {
  if (n != null) map.set(key, (map.get(key) ?? 0) + n);
};

function periodOf(
  days: readonly AnalyticsDay[],
  range: DateRange,
  hosts: ReadonlyMap<string, string>,
  articleId: string | undefined,
) {
  const articles = new Map<string, Reading>();
  const reading = (id: string) => {
    let found = articles.get(id);
    if (!found) articles.set(id, (found = new Reading()));
    return found;
  };
  const site = {
    pageViews: null as number | null,
    search: new Search(),
    adsense: null as number | null,
    adsensePages: null as number | null,
    affiliateRewards: null as number | null,
  };
  const covered = new Map<string, AnalyticsDay[]>();
  const devices = new Map<string, number>(),
    channels = new Map<string, number>(),
    referrers = new Map<string, number>(),
    landings = new Map<string, number>(),
    searchTypes = new Map<string, number>();
  let outboundDays = 0,
    entryDays = 0;
  for (const day of days) {
    if (!inRange(day.date, range)) continue;
    covered.set(day.source, [...(covered.get(day.source) ?? []), day]);
    if (
      day.source === "ga4" &&
      day.rows.some((r) => r.grain === "site" && r.metrics["outboundClicks"] != null)
    )
      outboundDays++;
    if (day.source === "ga4" && day.rows.some((r) => r.grain === "entry")) entryDays++;
    for (const row of day.rows) {
      const m = row.metrics;
      if (row.grain === "device" && day.source === "ga4") {
        if (!articleId) bump(devices, row.key, m["pageViews"]);
        continue;
      }
      if (row.grain === "search_type" && day.source === "gsc_site") {
        if (!articleId) bump(searchTypes, row.key, m["clicks"]);
        continue;
      }
      if (row.grain === "entry" && day.source === "ga4") {
        if (articleId && row.articleId !== articleId) continue;
        const key = entryKey(row);
        if (!key) continue;
        const n = m["entrances"];
        const channel = classifyChannel(key);
        bump(channels, channel, n);
        bump(
          referrers,
          key.source || key.medium
            ? `utm:${key.source || "(none)"}/${key.medium || "(none)"}`
            : key.referrer || "(direct)",
          n,
        );
        if (row.articleId) {
          bump(landings, row.articleId, n);
          const r = reading(row.articleId);
          r.entrances = add(r.entrances, n);
          if (n != null) r.channels[channel] = (r.channels[channel] ?? 0) + n;
        }
        continue;
      }
      if (row.grain === "site") {
        if (day.source === "ga4") site.pageViews = add(site.pageViews, m["pageViews"]);
        else if (day.source === "gsc_site") site.search.add(m);
        else if (day.source === "adsense")
          site.adsense = add(site.adsense, m["estimatedEarningsJPY"]);
        else if (day.source === "affiliate")
          site.affiliateRewards = add(site.affiliateRewards, m["confirmedRewardJPY"]);
        continue;
      }
      const id = row.articleId;
      if (!id || (articleId && id !== articleId)) continue;
      if (row.grain === "page") {
        if (day.source === "ga4")
          reading(id).pageViews = add(reading(id).pageViews, m["pageViews"]);
        else if (day.source === "gsc_url") reading(id).search.add(m);
        else if (day.source === "adsense") {
          reading(id).adsense = add(reading(id).adsense, m["estimatedEarningsJPY"]);
          site.adsensePages = add(site.adsensePages, m["estimatedEarningsJPY"]);
        } else if (day.source === "affiliate")
          reading(id).rewards = add(reading(id).rewards, m["confirmedRewardJPY"]);
      } else if (row.grain === "experience" && day.source === "ga4") {
        const key = experienceKey(row);
        const n = m["observations"] ?? 0;
        const r = reading(id);
        const device = (r.devices[key?.device ?? "unknown"] ??= { views: 0, ends: 0, next: 0 });
        if (key?.measurement === "article_view") {
          r.views += n;
          device.views += n;
        } else if (key?.measurement === "body_end") {
          r.ends += n;
          device.ends += n;
        } else if (key?.measurement === "body_75") r.body75 += n;
        else if (key?.measurement === "visible_time") r.visibleMs = add(r.visibleMs, m["valueSum"]);
        else if (key?.measurement === "next_article") {
          r.next += n;
          device.next += n;
          const area = key.placement ?? "unknown";
          r.areas[area] = (r.areas[area] ?? 0) + n;
        }
      } else if (row.grain === "outbound" && day.source === "ga4" && hosts.has(row.key))
        reading(id).affiliateClicks = add(reading(id).affiliateClicks, m["eventCount"]);
    }
  }
  // A day collected with outbound clicks and none of them is zero, not missing.
  if (outboundDays) for (const r of articles.values()) r.affiliateClicks ??= 0;
  let affiliateClicks: number | null = outboundDays ? 0 : null;
  for (const r of articles.values()) affiliateClicks = add(affiliateClicks, r.affiliateClicks);
  return {
    articles,
    site,
    covered,
    affiliateClicks,
    entryDays,
    counts: { devices, channels, referrers, landings, searchTypes },
  };
}

/** This period's counts beside the previous period's, largest first. */
function countRows(
  now: Map<string, number>,
  before: Map<string, number>,
  limit = Infinity,
): AnalyticsCountRowDto[] {
  return [...new Set([...now.keys(), ...before.keys()])]
    .map((key) => ({ key, current: now.get(key) ?? null, previous: before.get(key) ?? null }))
    .toSorted((a, b) => (b.current ?? 0) - (a.current ?? 0) || a.key.localeCompare(b.key))
    .slice(0, limit);
}
type Period = ReturnType<typeof periodOf>;

function totals(
  p: Period,
  articleId: string | undefined,
  users: number | null,
): AnalyticsTotalsDto {
  const has = (source: string) => (p.covered.get(source)?.length ?? 0) > 0;
  const one = articleId ? p.articles.get(articleId) : undefined;
  const search = articleId ? (one?.search ?? new Search()) : p.site.search;
  const searchSource = has(articleId ? "gsc_url" : "gsc_site");
  return {
    pageViews: has("ga4") ? (articleId ? (one?.pageViews ?? 0) : p.site.pageViews) : null,
    users: articleId ? null : users,
    searchClicks: searchSource ? (search.clicks ?? 0) : null,
    searchImpressions: searchSource ? (search.impressions ?? 0) : null,
    ctr: searchSource ? search.ctr : null,
    position: searchSource ? search.position : null,
    adsenseJPY: has("adsense") ? (articleId ? (one?.adsense ?? null) : p.site.adsense) : null,
    adsensePagesJPY: has("adsense")
      ? articleId
        ? (one?.adsense ?? null)
        : p.site.adsensePages
      : null,
    affiliateClicks: p.affiliateClicks,
    affiliateRewardJPY: has("affiliate")
      ? ((articleId ? one?.rewards : p.site.affiliateRewards) ?? 0)
      : null,
  };
}

/**
 * The one analytics answer, shared by the admin, ChatGPT and the saved weekly
 * and monthly reports: the same parts every time, lists paged.
 */
export async function analyticsView(
  store: AnalyticsStore,
  range: DateRange,
  articleId?: string,
  options: ViewOptions = {},
): Promise<AnalyticsViewDto> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const previous = previousRange(range);
  const [days, statuses, counts, queryPage, hostList] = await Promise.all([
    store.read({ start: previous.start, end: range.end }, [
      "site",
      "page",
      "experience",
      "outbound",
      "device",
      "entry",
      "search_type",
    ]),
    store.statuses(),
    articleId
      ? Promise.resolve([])
      : (store.readCounts?.([range, previous]) ?? Promise.resolve([])),
    store.queryPage
      ? store.queryPage(range, previous, articleId, limit, offset)
      : Promise.resolve({ rows: [], previous: [], total: 0 }),
    options.affiliateHosts?.() ?? Promise.resolve([]),
  ]);
  const hosts = new Map(hostList.map((h) => [h.host.toLowerCase(), h.provider]));
  const now = periodOf(days, range, hosts, articleId);
  const before = periodOf(days, previous, hosts, articleId);

  // Period users only when the count covers every collected day and is not older than them.
  const usersOf = (p: Period, r: DateRange) => {
    const count = counts.find((c) => c.start === r.start && c.end === r.end);
    const ga4 = p.covered.get("ga4") ?? [];
    return count &&
      count.coveredDays > 0 &&
      count.coveredDays >= ga4.length &&
      ga4.every((d) => d.retrievedAt <= count.retrievedAt)
      ? (count.metrics["users"] ?? null)
      : null;
  };

  const ids = [...new Set([...now.articles.keys(), ...before.articles.keys()])];
  const labels = (await options.labels?.(ids)) ?? new Map<string, AnalyticsArticleLabel>();
  const rows: AnalyticsArticleRowDto[] = [];
  for (const [id, r] of now.articles) {
    const p = before.articles.get(id);
    if ((r.pageViews ?? 0) <= 0 && r.views <= 0 && (r.search.clicks ?? 0) <= 0) continue;
    const label = labels.get(id);
    rows.push({
      articleId: id,
      title: label?.title ?? null,
      path: label?.path ?? null,
      publishedAt: label?.publishedAt ?? null,
      theme: articleTheme(label),
      pageViews: r.pageViews,
      pageViewsPrevious: p?.pageViews ?? null,
      clicks: r.search.clicks,
      clicksPrevious: p?.search.clicks ?? null,
      impressions: r.search.impressions,
      position: r.search.position,
      positionPrevious: p?.search.position ?? null,
      measuredViews: r.views,
      measuredViewsPrevious: p?.views ?? 0,
      bodyEndRate: ratio(r.ends, r.views),
      bodyEndRatePrevious: p ? ratio(p.ends, p.views) : null,
      nextArticleRate: ratio(r.next, r.views),
      nextArticleRatePrevious: p ? ratio(p.next, p.views) : null,
      nextArticleAreas: r.areas,
      adsenseJPY: r.adsense,
      affiliateClicks: r.affiliateClicks,
      body75Rate: ratio(r.body75, r.views),
      body75RatePrevious: p ? ratio(p.body75, p.views) : null,
      visibleSecondsPerView: r.visibleMs == null || !r.views ? null : r.visibleMs / r.views / 1000,
      devices: Object.fromEntries(
        Object.entries(r.devices)
          .filter(([, d]) => d.views > 0)
          .map(([device, d]) => [
            device,
            {
              measuredViews: d.views,
              bodyEndRate: ratio(d.ends, d.views),
              nextArticleRate: ratio(d.next, d.views),
            },
          ]),
      ),
      entrances: now.entryDays ? (r.entrances ?? 0) : null,
      entrancesPrevious: before.entryDays ? (p?.entrances ?? 0) : null,
      entranceChannels: now.entryDays ? r.channels : null,
    });
  }
  rows.sort(
    (a, b) =>
      (b.pageViews ?? b.measuredViews) - (a.pageViews ?? a.measuredViews) ||
      a.articleId.localeCompare(b.articleId),
  );

  const themes: AnalyticsThemeRowDto[] = [];
  if (!articleId) {
    const sum = (p: Period, theme: AnalyticsThemeDto, pick: (r: Reading) => number | null) => {
      let total: number | null = null;
      for (const [id, r] of p.articles)
        if (articleTheme(labels.get(id)) === theme) total = add(total, pick(r));
      return total;
    };
    for (const theme of ["chagee", "non_chagee", "unknown"] as const) {
      const pv = (p: Period) => {
        if (theme !== "unknown")
          return sum(p, theme, (r) => r.pageViews) ?? (p.site.pageViews == null ? null : 0);
        const known = add(
          sum(p, "chagee", (r) => r.pageViews),
          sum(p, "non_chagee", (r) => r.pageViews),
        );
        return p.site.pageViews == null ? null : p.site.pageViews - (known ?? 0);
      };
      const clicks = (p: Period) =>
        theme === "unknown" ? null : (sum(p, theme, (r) => r.search.clicks) ?? null);
      const current = pv(now),
        earlier = pv(before);
      themes.push({
        theme,
        pageViews: current,
        pageViewsPrevious: earlier,
        share: current == null ? null : ratio(current, now.site.pageViews ?? 0),
        sharePrevious: earlier == null ? null : ratio(earlier, before.site.pageViews ?? 0),
        searchClicks: clicks(now),
        searchClicksPrevious: clicks(before),
        adsenseJPY: theme === "unknown" ? null : sum(now, theme, (r) => r.adsense),
      });
    }
  }

  const earlierQueries = new Map(queryPage.previous.map((q) => [`${q.path}\u0000${q.key}`, q]));
  const queries: AnalyticsQueryRowDto[] = queryPage.rows.map((q) => ({
    query: q.key,
    intent: queryIntent(q.key),
    path: q.path,
    articleId: q.articleId,
    clicks: q.metrics["clicks"] ?? null,
    impressions: q.metrics["impressions"] ?? null,
    ctr: q.metrics["ctr"] ?? null,
    position: q.metrics["position"] ?? null,
    clicksPrevious: earlierQueries.get(`${q.path}\u0000${q.key}`)?.metrics["clicks"] ?? null,
  }));

  const landings = countRows(now.counts.landings, before.counts.landings, 20).map((row) => ({
    ...row,
    title: labels.get(row.key)?.title ?? null,
  }));
  const breakdowns = {
    devices: countRows(now.counts.devices, before.counts.devices),
    channels: now.entryDays ? countRows(now.counts.channels, before.counts.channels) : [],
    referrers: now.entryDays ? countRows(now.counts.referrers, before.counts.referrers, 20) : [],
    landings: articleId || !now.entryDays ? [] : landings,
    searchTypes: countRows(now.counts.searchTypes, before.counts.searchTypes),
    entryDays: now.entryDays,
  };
  const daily: AnalyticsDailyDto[] = dates(range).map((date) => {
    const p = periodOf(
      days.filter((d) => d.date === date),
      { start: date, end: date },
      hosts,
      articleId,
    );
    const one = articleId ? p.articles.get(articleId) : undefined;
    let views = 0,
      ends = 0,
      next = 0,
      chagee: number | null = null;
    for (const [id, r] of p.articles) {
      views += r.views;
      ends += r.ends;
      next += r.next;
      if (articleTheme(labels.get(id)) === "chagee") chagee = add(chagee, r.pageViews);
    }
    const t = totals(p, articleId, null);
    return {
      date,
      pageViews: articleId ? (t.pageViews == null ? null : (one?.pageViews ?? 0)) : t.pageViews,
      searchClicks: t.searchClicks,
      adsenseJPY: t.adsenseJPY,
      chageePageViews: articleId ? null : t.pageViews == null ? null : (chagee ?? 0),
      measuredViews: views,
      bodyEndRate: ratio(ends, views),
      nextArticleRate: ratio(next, views),
      provisional: [...p.covered.values()].flat().some((d) => d.provisional),
    };
  });
  const expected = dates(range).length;
  const sources: AnalyticsSourceStateDto[] = ANALYTICS_SOURCES.map((source) => {
    const collected = now.covered.get(source) ?? [];
    const status = statuses.find((s) => s.source === source);
    return {
      source,
      coveredDays: collected.length,
      expectedDays: expected,
      provisional: collected.some((d) => d.provisional),
      succeededAt: status?.succeededAt ?? null,
      error: status?.error ?? null,
    };
  });
  const articlePage = rows.slice(offset, offset + limit);
  return {
    range,
    previousRange: previous,
    scope: articleId ? "article" : "site",
    sources,
    totals: {
      current: totals(now, articleId, articleId ? null : usersOf(now, range)),
      previous: totals(before, articleId, articleId ? null : usersOf(before, previous)),
    },
    themes,
    articles: { total: rows.length, offset, returned: articlePage.length, rows: articlePage },
    queries: { total: queryPage.total, offset, returned: queries.length, rows: queries },
    breakdowns,
    daily,
    anchorTest: anchorTestSummary(days, range, articleId),
    notes: NOTES,
  };
}
