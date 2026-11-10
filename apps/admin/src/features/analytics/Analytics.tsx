import { useMemo, useState } from "react";
import type { AnalyticsDashboardDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { reviewReasons } from "../../lib/analytics-review";
import { formatDateTime } from "../../lib/labels";
import { Button, Empty, Loaded, Page, Panel, Tabs, TextInput } from "../../ui/parts";

const jstDay = (offset = 0) =>
  new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const fmt = (value: number | null | undefined, percent = false) =>
  value === null || value === undefined
    ? "—"
    : percent
      ? `${(value * 100).toFixed(1)}%`
      : value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
const CARDS = [
  ["PV", "ga4", "pageViews", false],
  ["ユーザー", "ga4", "users", false],
  ["検索クリック", "gsc_site", "clicks", false],
  ["表示回数", "gsc_site", "impressions", false],
  ["CTR", "gsc_site", "ctr", true],
  ["平均順位", "gsc_site", "position", false],
  ["AdSense（円）", "adsense", "estimatedEarningsJPY", false],
  ["アフィリエイト成果", "affiliate", "confirmedConversions", false],
] as const;

/** The owner's private numbers: the period's headline, articles to look at, likes. */
export function Analytics() {
  useTitle("分析");
  const [tab, setTab] = useState<"overview" | "articles" | "likes" | "data">("overview");
  const [start, setStart] = useState(jstDay(-28));
  const [end, setEnd] = useState(jstDay(-1));
  // Only what these tabs show: the A/B cohorts and page lists are left to the MCP.
  const dashboard = useOp("analytics.dashboard", {
    start,
    end,
    sections: ["articles", "queries"],
    limit: 100,
  });
  return (
    <Page title="分析" back={{ href: href.more(), label: "その他" }}>
      <div className="inline">
        <TextInput label="開始" type="date" value={start} onChange={setStart} />
        <TextInput label="終了" type="date" value={end} onChange={setEnd} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "概要" },
          { value: "articles", label: "記事" },
          { value: "likes", label: "いいね" },
          { value: "data", label: "取得状況" },
        ]}
      />
      {tab === "likes" ? (
        <Likes />
      ) : (
        <Loaded resource={dashboard} lines={6}>
          {({ dashboard: data }) =>
            tab === "overview" ? (
              <Overview data={data} />
            ) : tab === "articles" ? (
              <ArticleTable data={data} />
            ) : (
              <DataState data={data} />
            )
          }
        </Loaded>
      )}
    </Page>
  );
}

const metric = (list: AnalyticsDashboardDto["current"], source: string, key: string) =>
  list.find((s) => s.source === source)?.metrics?.[key] ?? null;

function Overview({ data }: { data: AnalyticsDashboardDto }) {
  return (
    <>
      <p className="muted">
        {data.range.start}〜{data.range.end}（前期間 {data.previousRange.start}〜
        {data.previousRange.end}）
      </p>
      <div className="stats">
        {CARDS.map(([label, source, key, percent]) => {
          const now = metric(data.current, source, key);
          const before = metric(data.previous, source, key);
          return (
            <div key={label} className="stat">
              <span className="stat__value">{fmt(now, percent)}</span>
              <span className="stat__label">
                {label}
                {before !== null && now !== null ? ` · 前 ${fmt(before, percent)}` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <Panel title="検索クエリ" collapsible>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>クエリ</th>
                <th className="num">クリック</th>
                <th className="num">CTR</th>
                <th className="num">順位</th>
              </tr>
            </thead>
            <tbody>
              {(data.queries ?? []).slice(0, 30).map((row) => (
                <tr key={row.key}>
                  <td>{row.key}</td>
                  <td className="num">{fmt(row.metrics["clicks"])}</td>
                  <td className="num">{fmt(row.metrics["ctr"], true)}</td>
                  <td className="num">{fmt(row.metrics["position"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function ArticleTable({ data }: { data: AnalyticsDashboardDto }) {
  const articles = useOp("article.list");
  const byId = useMemo(
    () => new Map((articles.data?.items ?? []).map((a) => [a.id, a])),
    [articles.data],
  );
  const rows = (data.articles ?? []).toSorted((a, b) => (b.pageViews ?? 0) - (a.pageViews ?? 0));
  if (rows.length === 0) return <Empty>この期間の記事データはありません。</Empty>;
  const listed = data.lists["articles"];
  const more = listed ? listed.total - listed.offset - listed.returned : 0;
  return (
    <div className="table-wrap">
      {more > 0 ? (
        <p className="muted">
          PV の多い {rows.length} 本を表示（ほか {more} 本）
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>記事</th>
            <th className="num">PV</th>
            <th className="num">読了</th>
            <th className="num">検索</th>
            <th className="num">収益</th>
            <th>見直し</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const article = byId.get(row.articleId);
            return (
              <tr key={row.articleId}>
                <td>
                  <a href={href.article(row.articleId)}>
                    {article?.title ?? row.path ?? row.articleId}
                  </a>
                </td>
                <td className="num">{fmt(row.pageViews)}</td>
                <td className="num">{fmt(row.bodyEndRate, true)}</td>
                <td className="num">{fmt(row.clicks)}</td>
                <td className="num">{fmt(row.earningsJPY)}</td>
                <td>
                  {reviewReasons(row, article?.contentUpdatedAt ?? article?.updatedAt ?? null).join(
                    "・",
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataState({ data }: { data: AnalyticsDashboardDto }) {
  const { busy, run } = useAction();
  const reports = useOp("analytics.savedReports");
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>取得元</th>
              <th>期間の取得</th>
              <th>最終成功</th>
              <th>エラー</th>
            </tr>
          </thead>
          <tbody>
            {data.statuses.map((status) => {
              const coverage = data.current.find((s) => s.source === status.source);
              return (
                <tr key={status.source}>
                  <td>{status.source}</td>
                  <td>{coverage ? `${coverage.coveredDays}/${coverage.expectedDays}日` : "—"}</td>
                  <td>{formatDateTime(status.succeededAt)}</td>
                  <td>{status.error ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="inline">
        {(["all", "counts"] as const).map((scope) => (
          <Button
            key={scope}
            busy={busy === scope}
            onClick={() =>
              void run(
                scope,
                () =>
                  op("analytics.recollect", {
                    start: data.range.start,
                    end: data.range.end,
                    scope,
                  }),
                {
                  done: "再集計を起動しました。数分で反映されます",
                },
              )
            }
          >
            {scope === "all" ? "この期間を再集計" : "期間人数だけ再集計"}
          </Button>
        ))}
      </div>
      <Panel title="保存済みレポート" collapsible>
        <Loaded resource={reports}>
          {(r) => (
            <ul className="state-lines">
              {r.items.map((item) => (
                <li key={`${item.period}-${item.start}`}>
                  {item.period === "weekly" ? "週次" : "月次"} {item.start}〜{item.end}（
                  {formatDateTime(item.generatedAt)}）
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Panel>
    </>
  );
}

function Likes() {
  const likes = useOp("like.activity");
  const articles = useOp("article.list");
  const titleOf = (id: string) => articles.data?.items.find((a) => a.id === id)?.title ?? id;
  return (
    <Loaded resource={likes}>
      {(data) => (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat__value">{data.total}</span>
              <span className="stat__label">いいね</span>
            </div>
            <div className="stat">
              <span className="stat__value">{data.visitors}</span>
              <span className="stat__label">押した人</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <tbody>
                {data.articles.map((row) => (
                  <tr key={row.articleId}>
                    <td>
                      <a href={href.article(row.articleId)}>{titleOf(row.articleId)}</a>
                    </td>
                    <td className="num">{row.count}</td>
                    <td>{formatDateTime(row.lastLikedAt).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Loaded>
  );
}
