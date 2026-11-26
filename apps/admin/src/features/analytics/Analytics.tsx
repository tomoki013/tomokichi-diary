import { useMemo, useState } from "react";
import type {
  AnalyticsCountRowDto,
  AnalyticsListPageDto,
  AnalyticsTotalsDto,
  AnalyticsViewDto,
} from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { reviewReasons } from "../../lib/analytics-review";
import { formatDateTime } from "../../lib/labels";
import { Button, Empty, Loaded, Page, Panel, Tabs, TextInput } from "../../ui/parts";

const PAGE = 20;
const jstDay = (offset = 0) =>
  new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const fmt = (value: number | null | undefined, percent = false) =>
  value === null || value === undefined
    ? "—"
    : percent
      ? `${(value * 100).toFixed(1)}%`
      : value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
const yen = (value: number | null | undefined) => (value == null ? "—" : `¥${fmt(value)}`);
const THEMES = { chagee: "CHAGEE", non_chagee: "非CHAGEE", unknown: "分類不明" } as const;
const INTENTS = {
  brand: "ブランド名だけ",
  chagee_specific: "CHAGEE＋具体的",
  non_chagee: "非CHAGEE",
  unknown: "不明",
} as const;
const AREAS: Record<string, string> = {
  nav_body: "本文",
  nav_next: "次の記事",
  nav_related: "関連",
  nav_series: "シリーズ",
  nav_adjacent: "前後",
  none: "場所不明",
  unknown: "場所不明",
};
const DEVICES: Record<string, string> = { mobile: "スマホ", desktop: "PC", tablet: "タブレット" };
const CHANNELS: Record<string, string> = {
  organic_search: "検索",
  ai_assistant: "AI",
  social: "SNS",
  referral: "他サイト",
  direct: "直接",
  email: "メール",
  campaign: "キャンペーン",
  internal: "サイト内",
};
const CARDS: [string, keyof AnalyticsTotalsDto, boolean?][] = [
  ["PV", "pageViews"],
  ["ユーザー（期間）", "users"],
  ["検索クリック", "searchClicks"],
  ["検索表示", "searchImpressions"],
  ["CTR", "ctr", true],
  ["平均順位", "position"],
  ["AdSense（円）", "adsenseJPY"],
  ["アフィリクリック", "affiliateClicks"],
];

/** The owner's private numbers: one view, the same one ChatGPT reads. */
export function Analytics() {
  useTitle("分析");
  const [tab, setTab] = useState<"overview" | "articles" | "data" | "likes">("overview");
  const [start, setStart] = useState(jstDay(-28));
  const [end, setEnd] = useState(jstDay(-1));
  const [offset, setOffset] = useState(0);
  const preset = (monthly: boolean) => {
    const today = new Date(jstDay() + "T00:00:00Z");
    if (monthly) today.setUTCDate(0);
    else today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7) - 1);
    setEnd(today.toISOString().slice(0, 10));
    today.setUTCDate(monthly ? 1 : today.getUTCDate() - 6);
    setStart(today.toISOString().slice(0, 10));
    setOffset(0);
  };
  const view = useOp("analytics.dashboard", { start, end, limit: PAGE, offset });
  return (
    <Page title="分析" back={{ href: href.more(), label: "その他" }}>
      <div className="inline">
        <TextInput
          label="開始"
          type="date"
          value={start}
          onChange={(v) => {
            setStart(v);
            setOffset(0);
          }}
        />
        <TextInput
          label="終了"
          type="date"
          value={end}
          onChange={(v) => {
            setEnd(v);
            setOffset(0);
          }}
        />
        <Button onClick={() => preset(false)}>直近の完了週</Button>
        <Button onClick={() => preset(true)}>前月</Button>
      </div>
      <Tabs
        value={tab}
        onChange={(v) => {
          setTab(v);
          setOffset(0);
        }}
        options={[
          { value: "overview", label: "概要" },
          { value: "articles", label: "記事" },
          { value: "data", label: "取得状況" },
          { value: "likes", label: "いいね" },
        ]}
      />
      {tab === "likes" ? (
        <Likes />
      ) : (
        <Loaded resource={view} lines={6}>
          {({ dashboard: data }) => (
            <>
              <Coverage data={data} />
              {tab === "overview" ? (
                <Overview data={data} />
              ) : tab === "articles" ? (
                <>
                  <ArticleTable data={data} />
                  <Paging page={data.articles} offset={offset} onChange={setOffset} />
                </>
              ) : (
                <DataState data={data} />
              )}
            </>
          )}
        </Loaded>
      )}
    </Page>
  );
}

/** Which period, against which, and whether every source is in. */
function Coverage({ data }: { data: AnalyticsViewDto }) {
  const short = data.sources.filter((s) => s.coveredDays < s.expectedDays && s.coveredDays > 0);
  return (
    <p className="muted">
      {data.range.start}〜{data.range.end}（前期間 {data.previousRange.start}〜
      {data.previousRange.end}）。— は未取得。
      {short.length
        ? ` 取得途中：${short.map((s) => `${s.source} ${s.coveredDays}/${s.expectedDays}日`).join("、")}。`
        : ""}
      {data.sources.some((s) => s.provisional) ? " 暫定値を含む。" : ""}
    </p>
  );
}

function Paging({
  page,
  offset,
  onChange,
}: {
  page: AnalyticsListPageDto;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (page.total <= PAGE) return null;
  return (
    <div className="inline">
      <Button disabled={!offset} onClick={() => onChange(Math.max(0, offset - PAGE))}>
        前の{PAGE}件
      </Button>
      <span>
        {offset + 1}〜{offset + page.returned} / {page.total}件
      </span>
      <Button
        disabled={offset + page.returned >= page.total}
        onClick={() => onChange(offset + PAGE)}
      >
        次の{PAGE}件
      </Button>
    </div>
  );
}

function Overview({ data }: { data: AnalyticsViewDto }) {
  const { current, previous } = data.totals;
  const anchor = (variant: "A" | "B") =>
    data.anchorTest.find((r) => r.device === "all" && r.variant === variant);
  return (
    <>
      <div className="stats">
        {CARDS.map(([label, key, percent]) => (
          <div key={key} className="stat">
            <span className="stat__value">{fmt(current[key], percent)}</span>
            <span className="stat__label">
              {label}
              {previous[key] != null ? ` · 前 ${fmt(previous[key], percent)}` : ""}
            </span>
          </div>
        ))}
      </div>
      <Panel title="CHAGEE と それ以外">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>テーマ</th>
                <th className="num">PV</th>
                <th className="num">前期</th>
                <th className="num">構成比</th>
                <th className="num">前期</th>
                <th className="num">検索クリック</th>
                <th className="num">AdSense</th>
              </tr>
            </thead>
            <tbody>
              {data.themes.map((t) => (
                <tr key={t.theme}>
                  <td>{THEMES[t.theme]}</td>
                  <td className="num">{fmt(t.pageViews)}</td>
                  <td className="num">{fmt(t.pageViewsPrevious)}</td>
                  <td className="num">{fmt(t.share, true)}</td>
                  <td className="num">{fmt(t.sharePrevious, true)}</td>
                  <td className="num">{fmt(t.searchClicks)}</td>
                  <td className="num">{yen(t.adsenseJPY)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          AdSense はサイト合計 {yen(current.adsenseJPY)} のうち記事別に分かる{" "}
          {yen(current.adsensePagesJPY)}。残りは記事に割り振らない。
        </p>
      </Panel>
      <Panel title="流入と端末">
        {data.breakdowns.entryDays === 0 ? (
          <p className="muted">この期間は流入経路を取得していません。</p>
        ) : null}
        <Counts title="流入経路（訪問）" rows={data.breakdowns.channels} labels={CHANNELS} />
        <Counts title="参照元（上位）" rows={data.breakdowns.referrers} />
        <Counts
          title="入口の記事（上位）"
          rows={data.breakdowns.landings.map((r) => ({ ...r, key: r.title ?? r.key }))}
        />
        <Counts title="端末（PV）" rows={data.breakdowns.devices} labels={DEVICES} />
        <Counts title="検索の種類（クリック）" rows={data.breakdowns.searchTypes} />
      </Panel>
      <Panel title="日別" collapsible>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th className="num">PV</th>
                <th className="num">CHAGEE</th>
                <th className="num">検索クリック</th>
                <th className="num">末尾到達</th>
                <th className="num">回遊</th>
                <th className="num">AdSense</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.date}>
                  <td>
                    {d.date.slice(5)}
                    {d.provisional ? "*" : ""}
                  </td>
                  <td className="num">{fmt(d.pageViews)}</td>
                  <td className="num">{fmt(d.chageePageViews)}</td>
                  <td className="num">{fmt(d.searchClicks)}</td>
                  <td className="num">{fmt(d.bodyEndRate, true)}</td>
                  <td className="num">{fmt(d.nextArticleRate, true)}</td>
                  <td className="num">{yen(d.adsenseJPY)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">* は暫定値を含む日。</p>
      </Panel>
      <Panel title="検索クエリ" collapsible>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>クエリ</th>
                <th>意図</th>
                <th className="num">クリック</th>
                <th className="num">前期</th>
                <th className="num">CTR</th>
                <th className="num">順位</th>
              </tr>
            </thead>
            <tbody>
              {data.queries.rows.map((q) => (
                <tr key={JSON.stringify([q.path, q.query])}>
                  <td>{q.query}</td>
                  <td>{INTENTS[q.intent]}</td>
                  <td className="num">{fmt(q.clicks)}</td>
                  <td className="num">{fmt(q.clicksPrevious)}</td>
                  <td className="num">{fmt(q.ctr, true)}</td>
                  <td className="num">{fmt(q.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          上位 {data.queries.returned} 件 / 全 {data.queries.total} 件
        </p>
      </Panel>
      {anchor("A") || anchor("B") ? (
        <Panel title="アンカー広告テスト（全端末）">
          <p>
            A（なし）{fmt(anchor("A")?.views)}表示・末尾 {fmt(anchor("A")?.bodyEndRate, true)}・回遊{" "}
            {fmt(anchor("A")?.nextArticleRate, true)} ／ B（あり）{fmt(anchor("B")?.views)}
            表示・末尾 {fmt(anchor("B")?.bodyEndRate, true)}・回遊{" "}
            {fmt(anchor("B")?.nextArticleRate, true)}
          </p>
          <a href={href.ads()}>端末別・広告の詳細</a>
        </Panel>
      ) : null}
    </>
  );
}

const NO_LABELS: Record<string, string> = {};
/** One small table of this period's counts beside the previous period's. */
function Counts({
  title,
  rows,
  labels = NO_LABELS,
}: {
  title: string;
  rows: AnalyticsCountRowDto[];
  labels?: Record<string, string>;
}) {
  if (!rows.length) return null;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">当期</th>
            <th className="num">前期</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{labels[r.key] ?? r.key}</td>
              <td className="num">{fmt(r.current)}</td>
              <td className="num">{fmt(r.previous)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArticleTable({ data }: { data: AnalyticsViewDto }) {
  const articles = useOp("article.list");
  const byId = useMemo(
    () => new Map((articles.data?.items ?? []).map((a) => [a.id, a])),
    [articles.data],
  );
  if (!data.articles.rows.length) return <Empty>この期間の記事データはありません。</Empty>;
  const pair = (now: number | null, before: number | null, percent = false) =>
    `${fmt(now, percent)}（${fmt(before, percent)}）`;
  return (
    <div className="table-wrap">
      <p className="muted">（）内は前期間。末尾・回遊の分母は計測表示。</p>
      <table>
        <thead>
          <tr>
            <th>記事</th>
            <th className="num">PV</th>
            <th className="num">訪問の入口</th>
            <th className="num">検索</th>
            <th className="num">75%到達</th>
            <th className="num">末尾到達</th>
            <th className="num">回遊</th>
            <th>回遊の導線</th>
            <th>端末別（計測表示・末尾・回遊）</th>
            <th className="num">可視秒</th>
            <th className="num">AdSense</th>
            <th className="num">アフィリ</th>
            <th>見直し</th>
          </tr>
        </thead>
        <tbody>
          {data.articles.rows.map((row) => {
            const article = byId.get(row.articleId);
            return (
              <tr key={row.articleId}>
                <td>
                  <a href={href.article(row.articleId)}>{row.title ?? row.path ?? row.articleId}</a>
                  {row.theme === "chagee" ? <small> CHAGEE</small> : null}
                </td>
                <td className="num">{pair(row.pageViews, row.pageViewsPrevious)}</td>
                <td className="num">{pair(row.entrances, row.entrancesPrevious)}</td>
                <td className="num">{pair(row.clicks, row.clicksPrevious)}</td>
                <td className="num">{pair(row.body75Rate, row.body75RatePrevious, true)}</td>
                <td className="num">{pair(row.bodyEndRate, row.bodyEndRatePrevious, true)}</td>
                <td className="num">
                  {pair(row.nextArticleRate, row.nextArticleRatePrevious, true)}
                </td>
                <td>
                  {Object.entries(row.nextArticleAreas)
                    .filter(([, n]) => n > 0)
                    .map(([area, n]) => `${AREAS[area] ?? area} ${n}`)
                    .join("・")}
                </td>
                <td>
                  {Object.entries(row.devices)
                    .map(
                      ([device, d]) =>
                        `${DEVICES[device] ?? device} ${d.measuredViews}・${fmt(d.bodyEndRate, true)}・${fmt(d.nextArticleRate, true)}`,
                    )
                    .join(" ／ ")}
                </td>
                <td className="num">{fmt(row.visibleSecondsPerView)}</td>
                <td className="num">{yen(row.adsenseJPY)}</td>
                <td className="num">{fmt(row.affiliateClicks)}</td>
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

function DataState({ data }: { data: AnalyticsViewDto }) {
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
            {data.sources.map((s) => (
              <tr key={s.source}>
                <td>{s.source}</td>
                <td>
                  {s.coveredDays}/{s.expectedDays}日{s.provisional ? "（暫定を含む）" : ""}
                </td>
                <td>{formatDateTime(s.succeededAt)}</td>
                <td>{s.error ?? ""}</td>
              </tr>
            ))}
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
