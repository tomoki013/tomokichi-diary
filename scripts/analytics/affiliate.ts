import { assertAnalyticsDay } from "@tomokichi/contracts";
import { resolveAnalyticsArticle, type AnalyticsDay } from "@tomokichi/application";
import type { Route } from "@tomokichi/domain";
export interface AffiliateRecord {
  provider: string;
  recordId: string;
  date: string;
  campaignId: string;
  url: string | null;
  currency: "JPY";
  clicks: number;
  pendingConversions: number;
  confirmedConversions: number;
  pendingReward: number;
  confirmedReward: number;
}
/** Each ASP adapter must emit a complete replacement snapshot for the requested dates, including all configured providers. */
export interface AffiliateAdapter {
  provider: string;
  parse(input: string): AffiliateRecord[];
}
export function affiliateDays(
  records: AffiliateRecord[],
  routes: readonly Route[],
  now: string,
): AnalyticsDay[] {
  const seen = new Set<string>();
  const days = new Map<string, AnalyticsDay>();
  for (const r of records) {
    if (!r.provider || !r.recordId || !r.campaignId || r.currency !== "JPY")
      throw new Error("ANALYTICS_AFFILIATE_INVALID");
    const identity = JSON.stringify([r.provider, r.recordId]);
    if (seen.has(identity)) throw new Error("ANALYTICS_AFFILIATE_DUPLICATE");
    seen.add(identity);
    const metrics = {
      linkClicks: r.clicks,
      pendingConversions: r.pendingConversions,
      confirmedConversions: r.confirmedConversions,
      pendingRewardJPY: r.pendingReward,
      confirmedRewardJPY: r.confirmedReward,
    };
    const resolved = r.url
      ? resolveAnalyticsArticle(r.url, routes)
      : { path: null, articleId: null };
    const rows = days.get(r.date)?.rows ?? [];
    // Counts/rewards are additive; site, campaign, page remain separate grains.
    for (const entry of [
      { grain: "site" as const, key: "JPY", path: null, articleId: null },
      {
        grain: "campaign" as const,
        key: JSON.stringify([r.provider, r.campaignId]),
        path: null,
        articleId: null,
      },
      ...(resolved.path ? [{ grain: "page" as const, key: resolved.path, ...resolved }] : []),
    ]) {
      const row = rows.find(
        (candidate) => candidate.grain === entry.grain && candidate.key === entry.key,
      );
      if (row)
        for (const [key, value] of Object.entries(metrics))
          row.metrics[key] = (row.metrics[key] ?? 0) + value;
      else rows.push({ ...entry, metrics: { ...metrics } });
    }
    days.set(r.date, {
      source: "affiliate",
      date: r.date,
      retrievedAt: now,
      provisional: true,
      rows,
    });
  }
  const output = [...days.values()];
  output.forEach(assertAnalyticsDay);
  return output;
}
