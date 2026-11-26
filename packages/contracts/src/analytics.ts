export interface ExperienceCohortDto {
  layout: string;
  device: string;
  measuredDays: number;
  firstDate: string;
  lastDate: string;
  views: number;
  reviewReady: boolean;
  bodyEndRate: number | null;
  candidate35Rate: number | null;
  candidate65Rate: number | null;
  adEligible: number;
  adRequests: number;
  adFilled: number;
  adUnfilled: number;
  adScriptErrors: number;
  adViewableProxy: number;
  adRequestRate: number | null;
  adFillRate: number | null;
  adViewableProxyRate: number | null;
  visibleMsPerView: number | null;
  nextArticleRate: number | null;
  /**
   * Taps on to another article by where the link sat: the NEXT card, the
   * related list, the series pair, the site-wide previous/next, a card in the
   * body, and "none" for taps recorded before areas were.
   */
  nextArticleAreas?: Record<string, number>;
  shareActionRate: number | null;
  likeActionRate: number | null;
  vitals: {
    vital: string;
    samples: number;
    good: number;
    needsImprovement: number;
    poor: number;
    p75Band: string;
  }[];
}
export interface AnalyticsMetricRowDto {
  grain: string;
  key: string;
  path: string | null;
  articleId: string | null;
  /** The article's published title, on landing pages only. */
  title?: string | null;
  metrics: Record<string, number | null>;
}
export interface ExperimentCohortDto extends ExperienceCohortDto {
  articleId?: string | null;
  path?: string | null;
  experimentId: string;
  variant: string;
  assignments: number;
  body25Rate: number | null;
  body50Rate: number | null;
  body75Rate: number | null;
  body90Rate: number | null;
}
export interface AnchorTestCohort extends Pick<
  ExperimentCohortDto,
  | "experimentId"
  | "layout"
  | "assignments"
  | "body25Rate"
  | "body50Rate"
  | "body75Rate"
  | "body90Rate"
  | "adEligible"
  | "adRequests"
  | "adFilled"
  | "adUnfilled"
  | "adScriptErrors"
  | "adRequestRate"
  | "adFillRate"
  | "adViewableProxy"
  | "adViewableProxyRate"
  | "vitals"
> {
  adMeasurementScope: "article_slots";
  anchorUnitRequests: null;
  anchorUnitFilled: null;
  device: "all" | "desktop" | "mobile" | "tablet";
  variant: "A" | "B";
  measuredDays: number;
  views: number;
  bodyEndRate: number | null;
  visibleMsPerView: number | null;
  nextArticleRate: number | null;
}

/** An article's classification for the CHAGEE share, from its published title, path and tags. */
export type AnalyticsThemeDto = "chagee" | "non_chagee" | "unknown";

/** One period's headline. null = not collected (never 0). */
export interface AnalyticsTotalsDto {
  pageViews: number | null;
  /** Distinct over the whole period from GA4 (not a sum of days); null when not counted. */
  users: number | null;
  searchClicks: number | null;
  searchImpressions: number | null;
  ctr: number | null;
  position: number | null;
  /** AdSense estimate for the site. */
  adsenseJPY: number | null;
  /** The part of adsenseJPY that Google attributed to a page; the rest is never apportioned. */
  adsensePagesJPY: number | null;
  /** GA4 outbound clicks to registered affiliate offers. */
  affiliateClicks: number | null;
  /** Imported ASP reports only. */
  affiliateRewardJPY: number | null;
}
export interface AnalyticsSourceStateDto {
  source: string;
  coveredDays: number;
  expectedDays: number;
  provisional: boolean;
  succeededAt: string | null;
  error: string | null;
}
export interface AnalyticsThemeRowDto {
  theme: AnalyticsThemeDto;
  pageViews: number | null;
  pageViewsPrevious: number | null;
  /** Of the site's page views in the same period. */
  share: number | null;
  sharePrevious: number | null;
  searchClicks: number | null;
  searchClicksPrevious: number | null;
  adsenseJPY: number | null;
}
/** One article for the period, with the previous period alongside. */
export interface AnalyticsArticleRowDto {
  articleId: string;
  title: string | null;
  path: string | null;
  publishedAt: string | null;
  theme: AnalyticsThemeDto;
  pageViews: number | null;
  pageViewsPrevious: number | null;
  clicks: number | null;
  clicksPrevious: number | null;
  impressions: number | null;
  position: number | null;
  positionPrevious: number | null;
  /** reader-v1 article views: the denominator of the three rates below. */
  measuredViews: number;
  measuredViewsPrevious: number;
  bodyEndRate: number | null;
  bodyEndRatePrevious: number | null;
  nextArticleRate: number | null;
  nextArticleRatePrevious: number | null;
  /** Moves on to another article this period, by where the link was (nav_body, nav_related, ...). */
  nextArticleAreas: Record<string, number>;
  adsenseJPY: number | null;
  affiliateClicks: number | null;
  body75Rate: number | null;
  body75RatePrevious: number | null;
  /** Seconds on screen per measured view. */
  visibleSecondsPerView: number | null;
  /** The same reading measurements per device (mobile, desktop, tablet). */
  devices: Record<
    string,
    { measuredViews: number; bodyEndRate: number | null; nextArticleRate: number | null }
  >;
  /** Visits that started on this article, and from where (null when visits were not measured). */
  entrances: number | null;
  entrancesPrevious: number | null;
  entranceChannels: Record<string, number> | null;
}
/** A count this period and the same count the period before. */
export interface AnalyticsCountRowDto {
  key: string;
  /** For landing pages: the article's title. */
  title?: string | null;
  current: number | null;
  previous: number | null;
}
export interface AnalyticsBreakdownsDto {
  /** GA4 page views by device. */
  devices: AnalyticsCountRowDto[];
  /** Visits (entrances) by channel: organic_search, ai_assistant, social, referral, direct... */
  channels: AnalyticsCountRowDto[];
  /** Visits by referring host or utm tag, top 20. */
  referrers: AnalyticsCountRowDto[];
  /** Visits by the article they started on, top 20 (site only). */
  landings: AnalyticsCountRowDto[];
  /** Search Console clicks by search type: web, discover, image, news (site only). */
  searchTypes: AnalyticsCountRowDto[];
  /** Days in the period with visit measurement; 0 means channels and referrers are not collected. */
  entryDays: number;
}
export interface AnalyticsDailyDto {
  date: string;
  pageViews: number | null;
  searchClicks: number | null;
  adsenseJPY: number | null;
  /** Site scope: CHAGEE articles' page views that day. */
  chageePageViews: number | null;
  measuredViews: number;
  bodyEndRate: number | null;
  nextArticleRate: number | null;
  provisional: boolean;
}
export type AnalyticsQueryIntentDto = "brand" | "chagee_specific" | "non_chagee" | "unknown";
export interface AnalyticsQueryRowDto {
  query: string;
  intent: AnalyticsQueryIntentDto;
  path: string | null;
  articleId: string | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  clicksPrevious: number | null;
}
/** How much of one list came back; `total` above `offset + returned` means there is more. */
export interface AnalyticsListPageDto {
  total: number;
  offset: number;
  returned: number;
}
/**
 * The whole analytics answer, the same for the admin and ChatGPT: always the
 * same parts, lists paged by limit/offset.
 */
export interface AnalyticsViewDto {
  range: { start: string; end: string };
  previousRange: { start: string; end: string };
  /** "article" when one article was asked for. */
  scope: "site" | "article";
  sources: AnalyticsSourceStateDto[];
  totals: { current: AnalyticsTotalsDto; previous: AnalyticsTotalsDto };
  themes: AnalyticsThemeRowDto[];
  articles: AnalyticsListPageDto & { rows: AnalyticsArticleRowDto[] };
  queries: AnalyticsListPageDto & { rows: AnalyticsQueryRowDto[] };
  breakdowns: AnalyticsBreakdownsDto;
  daily: AnalyticsDailyDto[];
  anchorTest: AnchorTestCohort[];
  notes: string[];
}
/** What the API knows of each article, to name and classify it. */
export interface AnalyticsArticleLabel {
  title: string | null;
  path: string | null;
  publishedAt: string | null;
  tags: string[];
}

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown) => v === null || typeof v === "string";
/** Reject malformed private payloads before they can replace a successful day. */
export function assertAnalyticsDay(value: unknown): void {
  if (
    !record(value) ||
    !["ga4", "gsc_site", "gsc_url", "adsense", "affiliate"].includes(String(value["source"])) ||
    typeof value["date"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value["date"]) ||
    !Number.isFinite(Date.parse(value["date"])) ||
    new Date(value["date"]).toISOString().slice(0, 10) !== value["date"] ||
    typeof value["retrievedAt"] !== "string" ||
    !Number.isFinite(Date.parse(value["retrievedAt"])) ||
    typeof value["provisional"] !== "boolean" ||
    !Array.isArray(value["rows"])
  )
    throw new Error("ANALYTICS_INVALID_DATA");
  const keys = new Set<string>();
  for (const row of value["rows"]) {
    if (
      !record(row) ||
      ![
        "site",
        "page",
        "query",
        "source",
        "device",
        "country",
        "search_type",
        "event",
        "campaign",
        "experience",
        "ad_unit",
        "entry",
        "outbound",
      ].includes(String(row["grain"])) ||
      typeof row["key"] !== "string" ||
      row["key"].length > 4096 ||
      !textOrNull(row["path"]) ||
      !textOrNull(row["articleId"]) ||
      !record(row["metrics"])
    )
      throw new Error("ANALYTICS_INVALID_DATA");
    const key = JSON.stringify([row["grain"], row["key"], row["path"]]);
    if (keys.has(key)) throw new Error("ANALYTICS_DUPLICATE_ROW");
    keys.add(key);
    for (const [metric, number] of Object.entries(row["metrics"])) {
      if (
        !/^[A-Za-z][A-Za-z0-9]{0,50}$/.test(metric) ||
        (number !== null && (typeof number !== "number" || !Number.isFinite(number) || number < 0))
      )
        throw new Error("ANALYTICS_INVALID_METRIC");
    }
    for (const metric of [
      "pageViews",
      "users",
      "activeUsers",
      "sessions",
      "engagedSessions",
      "engagementMs",
      "eventCount",
      "clicks",
      "impressions",
      "positionSum",
      "adImpressions",
      "adPageViews",
      "adClicks",
      "adRequests",
      "observations",
      "vitalGood",
      "vitalNeedsImprovement",
      "vitalPoor",
      "linkClicks",
      "outboundClicks",
      "entrances",
      "engagedEntrances",
      "entryPageViews",
      "singlePageEntrances",
      "pendingConversions",
      "confirmedConversions",
    ]) {
      const number = row["metrics"][metric];
      if (number != null && (typeof number !== "number" || !Number.isSafeInteger(number)))
        throw new Error("ANALYTICS_INVALID_METRIC");
    }
    const clicks = row["metrics"]["clicks"],
      impressions = row["metrics"]["impressions"];
    if (typeof clicks === "number" && typeof impressions === "number" && clicks > impressions)
      throw new Error("ANALYTICS_INVALID_METRIC");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 800000)
    throw new Error("ANALYTICS_DAY_TOO_LARGE");
}
