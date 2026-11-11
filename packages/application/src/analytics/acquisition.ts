import { addMetrics, type AnalyticsDay, type AnalyticsRow, type DateRange } from "./model.js";

/** What an entry row's key carries: where one group of visits came from. */
export interface EntryKey {
  /** Host of the page that linked here; "" when the browser sent none. */
  readonly referrer: string;
  /** utm_source / utm_medium on the landing address; "" when absent. */
  readonly source: string;
  readonly medium: string;
  readonly visitor: "new" | "returning" | "unknown";
}

export const CHANNELS = [
  "organic_search",
  "ai_assistant",
  "social",
  "referral",
  "direct",
  "email",
  "campaign",
  "internal",
] as const;
export type Channel = (typeof CHANNELS)[number];

const parsed = new WeakMap<AnalyticsRow, EntryKey | null>();
export function entryKey(row: AnalyticsRow): EntryKey | null {
  let key = parsed.get(row);
  if (key === undefined) {
    try {
      const value = JSON.parse(row.key) as Partial<EntryKey> | null;
      key =
        value && typeof value === "object"
          ? {
              referrer: String(value.referrer ?? ""),
              source: String(value.source ?? ""),
              medium: String(value.medium ?? ""),
              visitor:
                value.visitor === "new" || value.visitor === "returning"
                  ? value.visitor
                  : "unknown",
            }
          : null;
    } catch {
      key = null;
    }
    parsed.set(row, key);
  }
  return key;
}

const OWN = ["tomokichidiary.com"];
const AI = [
  "chatgpt.com",
  "openai.com",
  "perplexity.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "claude.ai",
  "felo.ai",
  "genspark.ai",
  "you.com",
  "phind.com",
  "grok.com",
  "deepseek.com",
];
const SEARCH = [
  "bing.com",
  "search.yahoo.co.jp",
  "search.yahoo.com",
  "duckduckgo.com",
  "baidu.com",
  "ecosia.org",
  "search.naver.com",
  "search.brave.com",
  "startpage.com",
  "search.goo.ne.jp",
  "com.google.android.googlequicksearchbox",
];
const SOCIAL = [
  "t.co",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "threads.net",
  "threads.com",
  "youtube.com",
  "linkedin.com",
  "lnkd.in",
  "reddit.com",
  "b.hatena.ne.jp",
  "line.me",
  "tiktok.com",
  "bsky.app",
  "weibo.com",
  "xiaohongshu.com",
  "com.twitter.android",
  "com.facebook.katana",
  "com.instagram.android",
  "jp.naver.line.android",
];
const MAIL = ["mail.google.com", "com.google.android.gm", "mail.yahoo.co.jp", "outlook.live.com"];
const SOCIAL_SOURCES = new Set([
  "x",
  "twitter",
  "facebook",
  "instagram",
  "threads",
  "line",
  "pinterest",
]);

const within = (host: string, domains: readonly string[]) =>
  domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

/**
 * The channel of a visit, from the landing address and the referrer only.
 * Google Discover arrives with a google referrer and is counted as search
 * here; Search Console's search_type separates it.
 */
export function classifyChannel(key: EntryKey): Channel {
  const { referrer, source, medium } = key;
  if (source || medium) {
    if (["email", "newsletter", "mail"].includes(medium)) return "email";
    if (["social", "sns"].includes(medium) || SOCIAL_SOURCES.has(source)) return "social";
    if (within(source, AI)) return "ai_assistant";
    return "campaign";
  }
  if (!referrer) return "direct";
  if (within(referrer, OWN)) return "internal";
  if (within(referrer, AI)) return "ai_assistant";
  if (within(referrer, MAIL)) return "email";
  if (
    /^(www\.)?google\.[a-z.]{2,6}$/.test(referrer) ||
    /(^|\.)yandex\.[a-z.]{2,6}$/.test(referrer) ||
    within(referrer, SEARCH)
  )
    return "organic_search";
  if (/(^|\.)pinterest\.[a-z.]{2,6}$/.test(referrer) || within(referrer, SOCIAL)) return "social";
  return "referral";
}

/** Entry metrics plus the share that were first visits. */
function entryMetrics(rows: readonly AnalyticsRow[]): Record<string, number | null> {
  const metrics = addMetrics(rows);
  metrics["newEntrances"] = rows.reduce(
    (sum, row) => sum + (entryKey(row)?.visitor === "new" ? (row.metrics["entrances"] ?? 0) : 0),
    0,
  );
  return metrics;
}

function grouped(
  rows: readonly AnalyticsRow[],
  grain: AnalyticsRow["grain"],
  keyOf: (row: AnalyticsRow) => string | null,
  shape: (key: string, first: AnalyticsRow) => Pick<AnalyticsRow, "path" | "articleId">,
): AnalyticsRow[] {
  const groups = new Map<string, AnalyticsRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups]
    .map(([key, list]) => ({
      grain,
      key,
      ...shape(key, list[0]!),
      metrics: entryMetrics(list),
    }))
    .toSorted((a, b) => (b.metrics["entrances"] ?? 0) - (a.metrics["entrances"] ?? 0));
}

const none = () => ({ path: null, articleId: null });

/**
 * Visits for a period by channel, by referring host and by landing page. With
 * an article, only the visits that landed on it. `null` when no day in the
 * period has entry rows (collected before this was measured).
 */
export function acquisition(days: readonly AnalyticsDay[], range: DateRange, articleId?: string) {
  const selected = days.filter(
    (day) => day.source === "ga4" && day.date >= range.start && day.date <= range.end,
  );
  const measured = selected.filter((day) => day.rows.some((row) => row.grain === "entry"));
  if (!measured.length) return null;
  const rows = measured
    .flatMap((day) => day.rows)
    .filter((row) => row.grain === "entry" && (!articleId || row.articleId === articleId));
  return {
    coveredDays: measured.length,
    channels: grouped(
      rows,
      "channel",
      (row) => {
        const key = entryKey(row);
        return key ? classifyChannel(key) : null;
      },
      none,
    ),
    referrers: grouped(
      rows,
      "referrer",
      (row) => {
        const key = entryKey(row);
        if (!key) return null;
        return key.source || key.medium
          ? `utm:${key.source || "(none)"}/${key.medium || "(none)"}`
          : key.referrer || "(direct)";
      },
      none,
    ),
    landings: grouped(
      rows,
      "landing",
      (row) => row.articleId ?? row.path,
      (_key, first) => ({ path: first.path, articleId: first.articleId }),
    ),
  };
}

/** One compact line per day for the long-range trend table. */
export interface AnalyticsFact {
  grain: "site" | "channel" | "article" | "search_type";
  key: string;
  pageViews: number | null;
  entrances: number | null;
  engagedEntrances: number | null;
  newEntrances: number | null;
  clicks: number | null;
  impressions: number | null;
  positionSum: number | null;
  earningsJPY: number | null;
}

const blank = (grain: AnalyticsFact["grain"], key: string): AnalyticsFact => ({
  grain,
  key,
  pageViews: null,
  entrances: null,
  engagedEntrances: null,
  newEntrances: null,
  clicks: null,
  impressions: null,
  positionSum: null,
  earningsJPY: null,
});

function add(
  target: AnalyticsFact,
  field: Exclude<keyof AnalyticsFact, "grain" | "key">,
  value: number | null | undefined,
): void {
  if (value === null || value === undefined) return;
  target[field] = (target[field] ?? 0) + value;
}

/**
 * What a collected day adds to the trend table: site totals, channels, search
 * types and one line per article. Only additive numbers: distinct users are
 * not here because they cannot be summed over days.
 */
export function factsOf(day: AnalyticsDay): AnalyticsFact[] {
  const facts = new Map<string, AnalyticsFact>();
  const fact = (grain: AnalyticsFact["grain"], key: string) => {
    const id = `${grain}\u0000${key}`;
    const found = facts.get(id) ?? blank(grain, key);
    facts.set(id, found);
    return found;
  };
  const search = (target: AnalyticsFact, row: AnalyticsRow) => {
    add(target, "clicks", row.metrics["clicks"]);
    add(target, "impressions", row.metrics["impressions"]);
    add(target, "positionSum", row.metrics["positionSum"]);
  };
  const entry = (target: AnalyticsFact, row: AnalyticsRow) => {
    add(target, "entrances", row.metrics["entrances"]);
    add(target, "engagedEntrances", row.metrics["engagedEntrances"]);
    add(target, "newEntrances", entryKey(row)?.visitor === "new" ? row.metrics["entrances"] : 0);
  };
  for (const row of day.rows) {
    if (day.source === "ga4") {
      if (row.grain === "site") add(fact("site", ""), "pageViews", row.metrics["pageViews"]);
      else if (row.grain === "page" && row.articleId)
        add(fact("article", row.articleId), "pageViews", row.metrics["pageViews"]);
      else if (row.grain === "entry") {
        const key = entryKey(row);
        if (!key) continue;
        entry(fact("site", ""), row);
        entry(fact("channel", classifyChannel(key)), row);
        if (row.articleId) entry(fact("article", row.articleId), row);
      }
    } else if (day.source === "gsc_site") {
      if (row.grain === "site") search(fact("site", ""), row);
      else if (row.grain === "search_type") search(fact("search_type", row.key), row);
    } else if (day.source === "gsc_url") {
      if (row.grain === "page" && row.articleId) search(fact("article", row.articleId), row);
    } else if (day.source === "adsense") {
      if (row.grain === "site")
        add(fact("site", ""), "earningsJPY", row.metrics["estimatedEarningsJPY"]);
      else if (row.grain === "page" && row.articleId)
        add(fact("article", row.articleId), "earningsJPY", row.metrics["estimatedEarningsJPY"]);
    }
  }
  return [...facts.values()];
}
