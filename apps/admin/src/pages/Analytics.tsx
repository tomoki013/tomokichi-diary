import { AnalyticsExperience } from "./AnalyticsExperience";
import { useState } from "react";
import type { AnalyticsDashboardDto, AnalyticsMetricRowDto } from "@tomokichi/contracts";
import { api } from "../lib/api";
import { useResource, useTitle } from "../ui/hooks";
import { EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";
import { useToast } from "../ui/toast";
import "./analytics.css";

const day = (date: Date) => date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
function preset(length: number) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - length + 1);
  return { start: day(start), end: day(end) };
}
const fmt = (value: number | null | undefined, percent = false) =>
  value == null
    ? "—"
    : percent
      ? `${(value * 100).toFixed(1)}%`
      : value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
const metricChange = (current: number | null | undefined, previous: number | null | undefined) =>
  current != null && previous != null && previous > 0
    ? `${current >= previous ? "+" : ""}${fmt((current - previous) / previous, true)}`
    : "—";
const labels: Record<string, string> = {
  ga4: "GA4（プロパティ日付）",
  gsc_site: "Search Console 全体（太平洋時間）",
  gsc_url: "Search Console ページ",
  adsense: "AdSense（推定 / JPY）",
  affiliate: "アフィリエイト",
};
function Chart({
  data,
  source,
  metric,
  label,
}: {
  data: AnalyticsDashboardDto;
  source: string;
  metric: string;
  label: string;
}) {
  const points = data.daily.map((d) => ({
    date: d.date,
    value: d.sources.find((s) => s.source === source)?.metrics?.[metric] ?? null,
  }));
  const max = Math.max(1, ...points.map((p) => p.value ?? 0));
  const width = 600 / points.length;
  return (
    <figure className="analytics-chart">
      <figcaption>
        {label} · {data.range.start}〜{data.range.end}
      </figcaption>
      <svg viewBox="0 0 600 150" aria-label={`${label}の日次推移。欠損日は底部の点で表示`}>
        {points.map((p, i) =>
          p.value === null ? (
            <circle
              key={p.date}
              cx={(i + 0.5) * width}
              cy="146"
              r="2"
              className="analytics-missing"
            >
              <title>{p.date}: 欠損</title>
            </circle>
          ) : (
            <rect
              key={p.date}
              x={i * width}
              y={140 - (130 * p.value) / max}
              width={Math.max(1, width - 2)}
              height={Math.max(1, (130 * p.value) / max)}
            >
              <title>
                {p.date}: {fmt(p.value)}
              </title>
            </rect>
          ),
        )}
      </svg>
    </figure>
  );
}
function Breakdown({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: AnalyticsMetricRowDto[];
  metric: string;
}) {
  return (
    <details className="analytics-breakdown">
      <summary>{title}</summary>
      <div className="analytics-table">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th>{metric}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((r) => (
              <tr key={JSON.stringify([r.path, r.key])}>
                <td>{r.key}</td>
                <td>{fmt(r.metrics[metric])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState>データがありません</EmptyState>}
      </div>
    </details>
  );
}
export function Analytics() {
  useTitle("Analytics");
  const toast = useToast();
  const [range, setRange] = useState(() => preset(28));
  const [articleId, setArticleId] = useState("");
  const [busy, setBusy] = useState(false);
  const resource = useResource(
    () => api.analytics(range.start, range.end, articleId),
    JSON.stringify([range, articleId]),
  );
  const data = resource.data;
  const reports = useResource(
    () => api.analyticsReports().then((r) => r.items),
    "analytics-reports",
  );
  const metrics = (source: string) => data?.current.find((s) => s.source === source)?.metrics ?? {};
  const previous = (source: string) =>
    data?.previous.find((s) => s.source === source)?.metrics ?? {};
  const cards = [
    ["PV", "ga4", "pageViews", false],
    ["期間ユーザー数", "ga4", "users", false],
    ["期間セッション数", "ga4", "sessions", false],
    ["検索クリック", articleId ? "gsc_url" : "gsc_site", "clicks", false],
    ["インプレッション", articleId ? "gsc_url" : "gsc_site", "impressions", false],
    ["CTR", articleId ? "gsc_url" : "gsc_site", "ctr", true],
    ["平均掲載順位", articleId ? "gsc_url" : "gsc_site", "position", false],
    ["AdSense推定収益（JPY）", "adsense", "estimatedEarningsJPY", false],
    ["アフィリエイト確定成果", "affiliate", "confirmedConversions", false],
  ] as const;
  const pages = new Map<string, { ga4?: AnalyticsMetricRowDto; gsc?: AnalyticsMetricRowDto }>();
  for (const row of data?.pages.ga4 ?? [])
    pages.set(row.articleId ?? row.path ?? row.key, { ga4: row });
  for (const row of data?.pages.gsc ?? []) {
    const key = row.articleId ?? row.path ?? row.key;
    pages.set(key, { ...pages.get(key), gsc: row });
  }
  const priorPage = (kind: "ga4" | "gsc", key: string) =>
    data?.pagesPrevious[kind].find((r) => (r.articleId ?? r.path ?? r.key) === key)?.metrics;
  async function recalculate() {
    setBusy(true);
    try {
      await api.recalculateAnalytics(range.start, range.end);
      toast.info("再集計を起動しました。Actionsで実行状況を確認できます。");
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="analytics">
      <PageHeader
        title="Analytics"
        meta="読者体験とコンテンツ品質を改善するための分析"
        actions={
          <button
            type="button"
            onClick={() => {
              void resource.reload();
              void reports.reload();
            }}
            disabled={resource.loading}
          >
            更新
          </button>
        }
      />
      <Panel title="集計期間">
        <div className="analytics-presets">
          {[7, 28, 90].map((n) => (
            <button type="button" key={n} onClick={() => setRange(preset(n))}>
              {n}日
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const end = preset(1).end;
              setRange({ start: `${end.slice(0, 7)}-01`, end });
            }}
          >
            月間
          </button>
        </div>
        <form
          className="analytics-range"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setRange({ start: String(f.get("start")), end: String(f.get("end")) });
          }}
          key={`${range.start}-${range.end}`}
        >
          <label>
            開始日
            <input type="date" name="start" required defaultValue={range.start} />
          </label>
          <label>
            終了日
            <input type="date" name="end" required defaultValue={range.end} />
          </label>
          <button type="submit">表示</button>
        </form>
        <p className="muted">
          任意期間・期間人数の集計は93日以内。日次データの再集計は31日以内で実行します。
        </p>
        <button type="button" onClick={() => void recalculate()} disabled={busy}>
          {busy ? "起動中…" : "この期間を再集計"}
        </button>{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            api
              .calculateAnalyticsCounts(range.start, range.end)
              .then(
                () => toast.info("期間人数の集計を起動しました。"),
                (error) => toast.error(error),
              )
              .finally(() => setBusy(false));
          }}
        >
          期間人数を集計
        </button>{" "}
        <a
          href="https://github.com/tomoki013/tomokichi-diary/actions/workflows/analytics-collect.yml"
          target="_blank"
          rel="noopener noreferrer"
        >
          Actions実行履歴 ↗
        </a>{" "}
        <a
          href="https://github.com/tomoki013/tomokichi-diary/actions/workflows/analytics-periods.yml"
          target="_blank"
          rel="noopener noreferrer"
        >
          期間人数の実行履歴 ↗
        </a>
        {articleId && (
          <p>
            記事別分析 <code>{articleId}</code>{" "}
            <button type="button" onClick={() => setArticleId("")}>
              全体に戻る
            </button>
          </p>
        )}
      </Panel>
      {resource.error !== undefined && (
        <ErrorState error={resource.error} onRetry={() => void resource.reload()} />
      )}
      {resource.loading && !data && <SkeletonRows />}
      {data && (
        <>
          <div className="analytics-cards">
            {cards
              .filter(([, , metric]) => !articleId || !["users", "sessions"].includes(metric))
              .map(([label, source, metric, percent]) => {
                const value = metrics(source)[metric],
                  prev = previous(source)[metric];
                const change =
                  value != null && prev != null && prev > 0 ? (value - prev) / prev : null;
                const coverage = data.current.find((s) => s.source === source);
                return (
                  <section className="panel" key={label}>
                    <h2>{label}</h2>
                    <strong>{fmt(value, percent)}</strong>
                    <p>
                      前期間 {fmt(prev, percent)}
                      {change !== null && ` / ${change >= 0 ? "+" : ""}${fmt(change, true)}`}
                    </p>
                    <small>
                      {metric === "users" || metric === "sessions"
                        ? fmt(metrics(source)["uniqueCoveredDays"])
                        : coverage?.coveredDays}
                      /{coverage?.expectedDays}日取得
                      {coverage?.provisional ? " · 暫定値あり" : ""}
                    </small>
                    {(metric === "users" || metric === "sessions") &&
                      coverage?.periodCountsRetrievedAt && (
                        <small>
                          期間集計更新{" "}
                          {new Date(coverage.periodCountsRetrievedAt).toLocaleString("ja-JP", {
                            timeZone: "Asia/Tokyo",
                          })}
                        </small>
                      )}
                  </section>
                );
              })}
          </div>
          <p className="muted">
            —
            は未取得または算出できない値です。期間ユーザー・セッションは期間全体のdistinct数です。期間集計が未取得・日次値より古い場合は—を表示します。未取得日がある期間は取得済み日だけのdistinct数です。取得日数が異なる前期間比較は参考値です。順位は小さいほど上位です。
          </p>
          <Panel title="収益の指標">
            <p>
              広告表示 {fmt(metrics("adsense")["adImpressions"])} / ページRPM（JPY）{" "}
              {fmt(metrics("adsense")["pageRPMJPY"])} / CPC（JPY）{" "}
              {fmt(metrics("adsense")["cpcJPY"])} / 広告CTR {fmt(metrics("adsense")["adCtr"], true)}
            </p>
            <p>
              ASPクリック {fmt(metrics("affiliate")["linkClicks"])} / 未確定成果{" "}
              {fmt(metrics("affiliate")["pendingConversions"])} / 未確定報酬（JPY）{" "}
              {fmt(metrics("affiliate")["pendingRewardJPY"])} / 確定報酬（JPY）{" "}
              {fmt(metrics("affiliate")["confirmedRewardJPY"])}
            </p>
            <p className="muted">AdSenseはサイト全体の推定値です。記事別への按分は行いません。</p>
          </Panel>
          <Panel title="日次推移">
            <Chart data={data} source="ga4" metric="pageViews" label="PV" />
            <Chart
              data={data}
              source={articleId ? "gsc_url" : "gsc_site"}
              metric="clicks"
              label="検索クリック"
            />
            {!articleId && <Chart data={data} source="ga4" metric="users" label="日次ユーザー数" />}
          </Panel>
          <Panel title="記事別実績">
            <div className="analytics-table">
              <table>
                <thead>
                  <tr>
                    <th>記事 / URL</th>
                    <th>PV</th>
                    <th>検索クリック</th>
                    <th>CTR</th>
                    <th>平均順位</th>
                    <th>エンゲージメント秒</th>
                    <th>PV 前比</th>
                    <th>検索クリック 前比</th>
                    <th>CTR 前期</th>
                    <th>順位 前期</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pages].map(([key, row]) => {
                    const sample = row.ga4 ?? row.gsc!;
                    return (
                      <tr key={key}>
                        <td>
                          {sample.articleId ? (
                            <button
                              type="button"
                              className="link"
                              onClick={() => setArticleId(sample.articleId!)}
                            >
                              {sample.path}
                            </button>
                          ) : (
                            sample.path
                          )}
                          <small>{!sample.articleId ? "未対応URL" : ""}</small>
                        </td>
                        <td>{fmt(row.ga4?.metrics["pageViews"])}</td>
                        <td>{fmt(row.gsc?.metrics["clicks"])}</td>
                        <td>{fmt(row.gsc?.metrics["ctr"], true)}</td>
                        <td>{fmt(row.gsc?.metrics["position"])}</td>
                        <td>
                          {fmt(
                            row.ga4?.metrics["engagementMs"] == null
                              ? null
                              : row.ga4.metrics["engagementMs"] / 1000,
                          )}
                        </td>
                        <td>
                          {metricChange(
                            row.ga4?.metrics["pageViews"],
                            priorPage("ga4", key)?.["pageViews"],
                          )}
                        </td>
                        <td>
                          {metricChange(
                            row.gsc?.metrics["clicks"],
                            priorPage("gsc", key)?.["clicks"],
                          )}
                        </td>
                        <td>{fmt(priorPage("gsc", key)?.["ctr"], true)}</td>
                        <td>{fmt(priorPage("gsc", key)?.["position"])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!pages.size && (
              <EmptyState>集計データがありません。初回backfill後に表示されます。</EmptyState>
            )}
          </Panel>
          <Panel title="主要検索クエリ">
            <div className="analytics-table">
              <table>
                <thead>
                  <tr>
                    <th>検索語</th>
                    <th>URL</th>
                    <th>クリック</th>
                    <th>CTR</th>
                    <th>平均順位</th>
                  </tr>
                </thead>
                <tbody>
                  {data.queries.map((row) => (
                    <tr key={JSON.stringify([row.path, row.key])}>
                      <td>{row.key}</td>
                      <td>{row.path}</td>
                      <td>{fmt(row.metrics["clicks"])}</td>
                      <td>{fmt(row.metrics["ctr"], true)}</td>
                      <td>{fmt(row.metrics["position"])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              匿名化された検索語は表示しません。表示できる検索語の合計は全体と一致しません。
            </p>
          </Panel>
          <Panel title="広告・読書体験">
            <AnalyticsExperience
              cohorts={data.experience?.current ?? []}
              previous={data.experience?.previous ?? []}
            />
          </Panel>
          <Panel title="内訳">
            <Breakdown
              title="初回ユーザー獲得元（セッション流入元とは異なる）"
              rows={data.breakdowns.sources}
              metric="pageViews"
            />
            <Breakdown title="GA4デバイス" rows={data.breakdowns.devices} metric="pageViews" />
            <Breakdown
              title="AdSense広告ユニット（推定収益JPY）"
              rows={data.breakdowns.adUnits ?? []}
              metric="estimatedEarningsJPY"
            />
            <Breakdown title="イベント" rows={data.breakdowns.events} metric="eventCount" />
            <Breakdown title="検索の国" rows={data.breakdowns.countries} metric="clicks" />
            <Breakdown title="検索タイプ" rows={data.breakdowns.searchTypes} metric="clicks" />
          </Panel>
          <Panel title="週次・月次レポート">
            {reports.error !== undefined && (
              <ErrorState error={reports.error} onRetry={() => void reports.reload()} />
            )}
            {(reports.data ?? []).map((report) => (
              <details className="analytics-breakdown" key={`${report.period}-${report.start}`}>
                <summary>
                  {report.period === "weekly" ? "週次" : "月次"} · {report.start}〜{report.end}
                </summary>
                <p>
                  生成{" "}
                  {new Date(report.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </p>
                <div className="analytics-table">
                  <table>
                    <thead>
                      <tr>
                        <th>ソース</th>
                        <th>取得日</th>
                        <th>PV / クリック / 推定収益（JPY）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.current.map((source) => (
                        <tr key={source.source}>
                          <td>{labels[source.source]}</td>
                          <td>
                            {source.coveredDays}/{source.expectedDays}
                            {source.provisional ? " 暫定" : ""}
                          </td>
                          <td>
                            {fmt(
                              source.metrics["pageViews"] ??
                                source.metrics["clicks"] ??
                                source.metrics["estimatedEarningsJPY"],
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <AnalyticsExperience
                  cohorts={report.experience?.current ?? []}
                  previous={report.experience?.previous ?? []}
                />
                <Breakdown
                  title="AdSense広告ユニット（推定収益JPY）"
                  rows={report.adUnits ?? []}
                  metric="estimatedEarningsJPY"
                />
                <p className="muted">{report.ai.reason}</p>
              </details>
            ))}
            {!reports.data?.length && !reports.error && (
              <EmptyState>週次・月次の集計が完了すると表示されます。</EmptyState>
            )}
          </Panel>
          <Panel title="データ取得状況">
            <ul className="analytics-status">
              {Object.entries(labels).map(([source, label]) => {
                const status = data.statuses.find((s) => s.source === source);
                return (
                  <li key={source}>
                    <strong>{label}</strong>
                    <span>最新データ日 {status?.latestDate ?? "未取得"}</span>
                    <span>
                      最終成功{" "}
                      {status?.succeededAt
                        ? new Date(status.succeededAt).toLocaleString("ja-JP", {
                            timeZone: "Asia/Tokyo",
                          })
                        : "未設定"}
                    </span>
                    <span>
                      最終試行{" "}
                      {status?.attemptedAt
                        ? new Date(status.attemptedAt).toLocaleString("ja-JP", {
                            timeZone: "Asia/Tokyo",
                          })
                        : "—"}
                    </span>
                    <span>
                      対象 {status?.start ?? "—"}〜{status?.end ?? "—"}
                    </span>
                    {status?.error && <code role="alert">{status.error}</code>}
                  </li>
                );
              })}
            </ul>
            <p className="muted">
              AdSense・ASP・AIの外部認証は独立した設定です。記事・広告・リンクの自動変更は行いません。
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
