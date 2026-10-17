import { useState } from "react";
import type {
  AffiliateOffer,
  AdExperiment,
  MonetizationOverviewDto,
  MonetizationSettings,
  AnalyticsDashboardDto,
  ArticleSummaryDto,
} from "@tomokichi/contracts";
import { adExperimentId } from "@tomokichi/contracts";
import { AdRollout } from "./AdRollout";
import { api } from "../lib/api";
import { href } from "../lib/route";
import { useResource, useTitle, useUnsavedWarning } from "../ui/hooks";
import { ErrorState, PageHeader, Panel } from "../ui/parts";
import { useToast } from "../ui/toast";
import { AffiliatePreview } from "./AffiliatePreview";
import "./monetization.css";
import "./analytics.css";
const tabs = ["概要", "広告設定", "アフィリエイト案件", "配置管理", "配置テスト"];
const number = (value: number | null | undefined) =>
  value == null ? "未取得" : value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const percent = (value: number | null | undefined) =>
  value == null ? "未取得" : `${(value * 100).toFixed(1)}%`;
function range() {
  const end = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", {
    timeZone: "Asia/Tokyo",
  });
  return { start: new Date(Date.parse(end) - 27 * 86400000).toISOString().slice(0, 10), end };
}
export function Monetization() {
  useTitle("収益化");
  const [tab, setTab] = useState(0);
  const data = useResource(() => api.monetization(), "monetization");
  const articles = useResource(() => api.listArticles(), "monetization-articles");
  const [period, setPeriod] = useState(range);
  const analytics = useResource(
    () => api.analytics(period.start, period.end),
    `monetization-analytics:${period.start}:${period.end}`,
  );
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);
  const overview = data.data;
  const ad = analytics.data?.current.find((s) => s.source === "adsense");
  const m = ad?.metrics;
  const cohorts = analytics.data
    ? [
        ...(analytics.data.experience?.current ?? []),
        ...(analytics.data.experiments?.current ?? []),
      ]
    : undefined;
  const sum = (key: "adScriptErrors" | "adViewableProxy" | "adFilled" | "adRequests") =>
    cohorts?.length ? cohorts.reduce((s, c) => s + c[key], 0) : null;
  return (
    <>
      <PageHeader title="収益化" meta={<a href={href.analytics()}>Analyticsの詳細へ →</a>} />
      <p>読書体験を守りながら配置を改善します。アフィリエイト報酬: 未設定・公開配信: 無効</p>
      <nav className="monetization-tabs" aria-label="収益化">
        {tabs.map((title, i) => (
          <button
            type="button"
            key={title}
            aria-current={tab === i ? "page" : undefined}
            onClick={() => {
              if (!dirty || confirm("未保存の変更があります。保存せずに移動しますか？")) {
                setDirty(false);
                setTab(i);
              }
            }}
          >
            {title}
          </button>
        ))}
      </nav>
      <div className="analytics-range">
        <label>
          開始日
          <input
            type="date"
            value={period.start}
            onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
          />
        </label>
        <label>
          終了日
          <input
            type="date"
            value={period.end}
            onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
          />
        </label>
        <span>93日以内・各指標の取得日数を確認してください</span>
      </div>
      {Boolean(data.error) && <ErrorState error={data.error} onRetry={() => void data.reload()} />}
      {!overview ? (
        <p>設定を読み込み中…</p>
      ) : (
        <>
          {tab === 0 && (
            <>
              <Panel title={`概要 · ${period.start}〜${period.end}`}>
                {Boolean(analytics.error) && (
                  <ErrorState error={analytics.error} onRetry={() => void analytics.reload()} />
                )}
                <dl className="monetization-metrics">
                  {[
                    ["AdSense推定収益（JPY）", number(m?.["estimatedEarningsJPY"])],
                    ["広告リクエスト数（公式）", number(m?.["adRequests"])],
                    ["広告表示回数（公式）", number(m?.["adImpressions"])],
                    ["広告Page RPM（JPY）", number(m?.["pageRPMJPY"])],
                    [
                      "配信率proxy（filled / request・GA4）",
                      sum("adRequests") ? percent(sum("adFilled")! / sum("adRequests")!) : "未取得",
                    ],
                    [
                      "表示率proxy（50%可視・1秒）",
                      sum("adFilled")
                        ? percent(sum("adViewableProxy")! / sum("adFilled")!)
                        : "未取得",
                    ],
                    ["広告を表示する公開記事数", number(overview.publishedAdArticles)],
                    [
                      "アフィリエイト配置予定数",
                      number(
                        overview.articles.reduce(
                          (s, a) =>
                            s + a.config.placements.filter((p) => p.kind === "affiliate").length,
                          0,
                        ),
                      ),
                    ],
                    [
                      "実施中の配置実験",
                      number(overview.experiments.filter((e) => e.status === "running").length),
                    ],
                    ["直近の広告スクリプトエラー（GA4観測）", number(sum("adScriptErrors"))],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  AdSense取得:{" "}
                  {ad
                    ? `${ad.coveredDays}/${ad.expectedDays}日 · ${!ad.coveredDays ? "未取得" : ad.provisional ? "暫定" : "取得済み"}`
                    : "未取得"}
                  。サイト合計とユニット別収益を合算しません。記事別・A/B収益は未取得です。
                </p>
                <p>
                  GA4の観測数と実際の広告表示数は一致しません。proxyはAdSense公式Active
                  Viewとは異なります。
                </p>
                {analytics.data?.statuses
                  .filter((s) => s.source === "adsense" && s.error)
                  .map((s) => (
                    <output key={s.source}>広告データ取得状況: {s.error}</output>
                  ))}
              </Panel>
            </>
          )}
          {tab === 1 && (
            <Settings initial={overview.settings} onDirty={setDirty} reload={data.reload} />
          )}
          {tab === 2 && <Offers data={overview} onDirty={setDirty} reload={data.reload} />}
          {tab === 3 && (
            <Panel title="配置管理">
              <p>
                位置の挿入・変更・削除・案件の割当は記事編集の「収益化」から操作します。マーカーが消えた配置は別の位置へ移動しません。
              </p>
              {overview.articles.length ? (
                <ul>
                  {overview.articles.map((a) => (
                    <li key={a.articleId}>
                      <a href={href.article(a.articleId)}>
                        {articles.data?.items.find((i) => i.id === a.articleId)?.title ??
                          a.articleId}
                      </a>{" "}
                      · {a.config.mode}
                      <ul>
                        {a.config.placements.map((p) => (
                          <li key={p.key}>
                            {p.key} · {p.position} · {p.status} ·{" "}
                            {p.kind === "affiliate"
                              ? (overview.offers.find((o) => o.id === p.offerId)?.name ??
                                "案件未割当")
                              : `AdSense ${p.adUnit}`}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>個別設定はまだありません。既存記事は末尾1枠の設定を維持します。</p>
              )}
              <a href={href.articles()}>記事一覧へ</a>
            </Panel>
          )}
          {tab === 4 && (
            <Experiments
              articles={articles.data?.items ?? []}
              data={overview}
              analytics={analytics.data}
              onDirty={setDirty}
              reload={data.reload}
            />
          )}
        </>
      )}
    </>
  );
}
function Settings({
  initial,
  onDirty,
  reload,
}: {
  initial: MonetizationSettings;
  onDirty: (dirty: boolean) => void;
  reload: () => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [unitKeys, setUnitKeys] = useState(() => initial.adUnits.map(() => crypto.randomUUID()));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  function update(patch: Partial<MonetizationSettings>) {
    setValue((v) => ({ ...v, ...patch }));
    onDirty(true);
  }
  return (
    <Panel title="広告設定">
      <p>
        保存は配信方針の下書きです。変更を適用する記事を個別に「変更を公開」してください。既存記事の一括変更は行いません。
      </p>
      {(
        [
          ["adsEnabled", "AdSenseを有効にする"],
          ["placementsEnabled", "個別の広告配置を有効にする"],
          ["experimentsEnabled", "配置実験を有効にする"],
        ] as const
      ).map(([key, label]) => (
        <label className="field" key={key}>
          <span>
            <input
              type="checkbox"
              checked={value[key]}
              onChange={(e) => update({ [key]: e.target.checked })}
            />{" "}
            {label}
          </span>
        </label>
      ))}
      <p>アフィリエイト: 無効（変更不可） / 最大広告枠数: 1</p>
      {value.adUnits.map((u, i) => (
        <div className="monetization-row" key={unitKeys[i]}>
          <label className="field">
            <span>広告ユニットID</span>
            <input
              inputMode="numeric"
              value={u.id}
              onChange={(e) =>
                update({
                  adUnits: value.adUnits.map((x, n) =>
                    n === i ? { ...x, id: e.target.value } : x,
                  ),
                })
              }
            />
          </label>
          <label className="field">
            <span>名称</span>
            <input
              value={u.name}
              onChange={(e) =>
                update({
                  adUnits: value.adUnits.map((x, n) =>
                    n === i ? { ...x, name: e.target.value } : x,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setUnitKeys((keys) => keys.filter((_, n) => n !== i));
              update({ adUnits: value.adUnits.filter((_, n) => n !== i) });
            }}
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setUnitKeys((keys) => [...keys, crypto.randomUUID()]);
          update({ adUnits: [...value.adUnits, { id: "", name: "新しい広告ユニット" }] });
        }}
      >
        ユニットを登録
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setValue(await api.saveMonetizationSettings(value));
            onDirty(false);
            toast.info("配信方針を保存しました。適用する記事を公開してください");
            await reload();
          } catch (e) {
            toast.error(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        設定を保存
      </button>
    </Panel>
  );
}
function Offers({
  data,
  onDirty,
  reload,
}: {
  data: MonetizationOverviewDto;
  onDirty: (d: boolean) => void;
  reload: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<AffiliateOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const choose = (offer: AffiliateOffer) => {
    setSelected(offer);
    onDirty(false);
  };
  return (
    <Panel title="アフィリエイト案件">
      <p>管理画面の準備専用です。「掲載中」にする操作はありません。</p>
      <div className="monetization-row">
        <select
          aria-label="案件選択"
          value={selected?.id ?? ""}
          onChange={(e) => {
            const o = data.offers.find((offer) => offer.id === e.target.value);
            if (o && confirm("編集中の内容を閉じて案件を開きますか？")) choose(o);
          }}
        >
          <option value="">案件を選択</option>
          {data.offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}（{o.status}）
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (selected && !confirm("編集中の内容を閉じて新規作成しますか？")) return;
            choose({
              id: "new",
              name: "新しい案件",
              provider: "",
              category: "宿泊",
              heading: "",
              description: "",
              imageUrl: null,
              url: null,
              format: "booking_card",
              notes: "",
              status: "draft",
              checkedAt: null,
              updatedAt: null,
            });
            onDirty(true);
          }}
        >
          案件を新規作成
        </button>
      </div>
      {selected && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              choose(await api.saveAffiliateOffer(selected));
              toast.info("案件を保存しました（本番非表示）");
              await reload();
            } catch (error) {
              toast.error(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            案件ID: <code>{selected.id}</code>
          </p>
          {(
            [
              ["name", "案件名"],
              ["provider", "提携サービス名"],
              ["category", "カテゴリ"],
              ["heading", "見出し"],
              ["description", "説明文"],
              ["imageUrl", "画像URL（任意）"],
              ["url", "リンク先URL（空欄可）"],
              ["notes", "管理メモ"],
            ] as const
          ).map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                required={key === "name"}
                value={selected[key] ?? ""}
                onChange={(e) => {
                  setSelected({
                    ...selected,
                    [key]: ["url", "imageUrl"].includes(key)
                      ? e.target.value || null
                      : e.target.value,
                  });
                  onDirty(true);
                }}
              />
            </label>
          ))}
          <label className="field">
            <span>表示形式</span>
            <select
              value={selected.format}
              onChange={(e) => {
                setSelected({ ...selected, format: e.target.value as AffiliateOffer["format"] });
                onDirty(true);
              }}
            >
              <option value="booking_card">シンプルな予約カード</option>
              <option value="text">テキストリンク</option>
              <option value="photo_card">写真付き紹介カード</option>
            </select>
          </label>
          <label className="field">
            <span>状態</span>
            <select
              value={selected.status}
              onChange={(e) => {
                setSelected({ ...selected, status: e.target.value as AffiliateOffer["status"] });
                onDirty(true);
              }}
            >
              <option value="draft">下書き</option>
              <option value="ready">掲載準備済み</option>
              <option value="paused">一時停止</option>
              <option value="archived">アーカイブ（復元不可）</option>
            </select>
          </label>
          <p>
            最終確認: {selected.checkedAt ?? "未確認"} / 最終編集: {selected.updatedAt ?? "未保存"}
          </p>
          <button
            type="button"
            onClick={() => {
              setSelected({ ...selected, checkedAt: new Date().toISOString() });
              onDirty(true);
            }}
          >
            確認日時を記録
          </button>
          <AffiliatePreview offer={selected} />
          <button className="primary" disabled={busy} type="submit">
            案件を保存
          </button>
        </form>
      )}
    </Panel>
  );
}
function Experiments({
  data,
  analytics,
  articles,
  onDirty,
  reload,
}: {
  data: MonetizationOverviewDto;
  analytics?: AnalyticsDashboardDto;
  articles: readonly ArticleSummaryDto[];
  onDirty: (d: boolean) => void;
  reload: () => Promise<void>;
}) {
  const [selection, setSelected] = useState(data.experiments[0]?.id ?? "");
  const selected = selection.startsWith("new:")
    ? (data.experiments.find((e) => e.articleId === selection.slice(4))?.id ?? selection)
    : selection;
  const [editingDirty, setEditingDirty] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  function selectExperiment(next: string) {
    if (editingDirty && !confirm("未保存の変更があります。保存せずに別の実験へ移動しますか？"))
      return;
    setEditingDirty(false);
    onDirty(false);
    setSelected(next);
  }
  return (
    <>
      <AdRollout
        articles={articles}
        overview={data}
        analytics={analytics}
        blocked={editingDirty}
        onBusy={(value) => {
          setBulkBusy(value);
          onDirty(value || editingDirty);
        }}
        reload={reload}
      />
      <Panel
        title={`記事別の配置テスト（実施中${data.experiments.filter((e) => e.status === "running").length}件）`}
      >
        <p>
          記事ごとに同時ランダム割当を行い、計測を分けます。異なる記事や開始日の数値を混ぜて勝者を判断しません。
        </p>
        <label className="field">
          <span>確認・編集する実験</span>
          <select
            disabled={bulkBusy}
            value={selected}
            onChange={(e) => selectExperiment(e.target.value)}
          >
            <option value="">実験を選択</option>
            {data.experiments.map((e) => (
              <option key={e.id} value={e.id}>
                {articles.find((a) => a.id === e.articleId)?.title ?? e.name}（{e.status}）
              </option>
            ))}
            {articles
              .filter(
                (a) =>
                  a.kind === "article" &&
                  a.isLive &&
                  !data.experiments.some((e) => e.articleId === a.id),
              )
              .map((a) => (
                <option key={a.id} value={`new:${a.id}`}>
                  新規: {a.title}
                </option>
              ))}
          </select>
        </label>
        <div className="analytics-table ad-experiment-list">
          <table>
            <caption>実験別の端末ごとの計測状況</caption>
            <thead>
              <tr>
                <th>記事</th>
                <th>状態</th>
                <th>mobile A / B</th>
                <th>desktop A / B</th>
              </tr>
            </thead>
            <tbody>
              {data.experiments.map((e) => (
                <tr key={e.id}>
                  <td>
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() => selectExperiment(e.id)}
                    >
                      {articles.find((a) => a.id === e.articleId)?.title ?? e.name}
                    </button>
                  </td>
                  <td>{e.status}</td>
                  {["mobile", "desktop"].map((device) => (
                    <td key={device}>
                      {["A", "B"]
                        .map((v) => {
                          const c = analytics?.experiments?.current.find(
                            (cohort) =>
                              cohort.experimentId === e.id &&
                              cohort.device === device &&
                              cohort.variant === v,
                          );
                          return c ? `${c.views}表示・${c.measuredDays}日` : "未取得";
                        })
                        .join(" / ")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {selected && (
        <ExperimentEditor
          key={selected}
          selected={selected}
          data={data}
          articles={articles}
          analytics={analytics}
          onDirty={(value) => {
            setEditingDirty(value);
            onDirty(value || bulkBusy);
          }}
          reload={reload}
        />
      )}
    </>
  );
}
function ExperimentEditor({
  articles,
  selected,
  data,
  analytics,
  onDirty,
  reload,
}: {
  articles: readonly ArticleSummaryDto[];
  selected: string;
  data: MonetizationOverviewDto;
  analytics?: AnalyticsDashboardDto;
  onDirty: (d: boolean) => void;
  reload: () => Promise<void>;
}) {
  const old = data.experiments.find((e) => e.id === selected);
  const articleId = old?.articleId ?? selected.replace(/^new:/, "");
  const [value, setValue] = useState<AdExperiment>(
    () =>
      old ?? {
        id: adExperimentId(articleId),
        articleId,
        name: "末尾 / 本文内",
        markerKey: "",
        adUnitA: "7152502134",
        adUnitB: "7152502134",
        shareB: 50,
        status: "draft",
        startedAt: null,
        stoppedAt: null,
        updatedAt: null,
      },
  );
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const update = (patch: Partial<AdExperiment>) => {
    setValue((v) => ({ ...v, ...patch }));
    onDirty(true);
  };
  const run = async (action?: "start" | "stop") => {
    setBusy(true);
    try {
      const result = action
        ? await api.controlAdExperiment(value.id, action)
        : await api.saveAdExperiment(value);
      setValue(result);
      onDirty(false);
      toast.info("実験を保存しました。記事で「変更を公開」して配信に反映してください");
      await reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="配置テスト">
      <p>A: 記事末尾1枠 / B: 本文内1枠。割当は表示ごとに行い、識別子を保存しません。</p>
      <fieldset disabled={busy || value.status !== "draft"}>
        <label className="field">
          <span>対象記事</span>
          <select value={value.articleId} disabled onChange={() => {}}>
            <option value={value.articleId}>
              {articles.find((a) => a.id === value.articleId)?.title ?? value.articleId}
            </option>
          </select>
        </label>
        <label className="field">
          <span>Bの本文配置キー</span>
          <input
            value={value.markerKey}
            onChange={(e) => update({ markerKey: e.target.value })}
            list="experiment-markers"
          />
          <datalist id="experiment-markers">
            {data.articles
              .find((a) => a.articleId === value.articleId)
              ?.config.placements.filter((p) => p.position === "marker")
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key}
                </option>
              ))}
          </datalist>
        </label>
        {(["adUnitA", "adUnitB"] as const).map((key) => (
          <label className="field" key={key}>
            <span>{key === "adUnitA" ? "Aの広告ユニット" : "Bの広告ユニット"}</span>
            <select value={value[key]} onChange={(e) => update({ [key]: e.target.value })}>
              {data.settings.adUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="field">
          <span>B配信比率（%・初期50）</span>
          <input
            type="number"
            min={10}
            max={90}
            value={value.shareB}
            onChange={(e) => update({ shareB: Number(e.target.value) })}
          />
        </label>
        <button type="button" onClick={() => void run()}>
          実験の下書きを保存
        </button>
      </fieldset>
      <p>
        現在: {value.status} / 開始: {value.startedAt ?? "未開始"} / 終了:{" "}
        {value.stoppedAt ?? "未終了"}
      </p>
      <button
        type="button"
        disabled={busy || !old || value.status !== "draft"}
        onClick={() => void run("start")}
      >
        開始を予約
      </button>
      <button
        type="button"
        disabled={busy || value.status !== "running"}
        onClick={() => void run("stop")}
      >
        停止を予約
      </button>{" "}
      <a href={href.article(value.articleId)}>記事の参加設定・公開へ →</a>
      <p>
        開始前に広告設定の「個別配置」「配置実験」を有効にし、記事編集で参加を保存します。開始・停止後とも記事の公開が必要です。停止すると末尾1枠に戻ります。
      </p>
      <p>
        同一ユニットを使う場合、公式収益をA/Bへ分離できません。別ユニットはAdSenseで手動作成し、広告設定へ登録してください。収益差は推定しません。
      </p>
      <ExperimentResults data={analytics} experimentId={value.id} />
    </Panel>
  );
}
function ExperimentResults({
  data,
  experimentId,
}: {
  data?: AnalyticsDashboardDto;
  experimentId: string;
}) {
  const cohorts = (data?.experiments?.current ?? []).filter((c) => c.experimentId === experimentId);
  return (
    <>
      <h3>A/B読書体験の比較</h3>
      <p>
        期間: {data ? `${data.range.start}〜${data.range.end}` : "未取得"}
        。端末別・各パターン200計測表示、14計測日は確認目安です。統計的な有意差を保証せず、勝者は表示しません。
      </p>
      {(["mobile", "desktop", "tablet"] as const).map((device) => {
        const a = cohorts.find((c) => c.device === device && c.variant === "A");
        const b = cohorts.find((c) => c.device === device && c.variant === "B");
        return (
          <div className="analytics-table" key={device}>
            <table>
              <caption>
                {device} ·{" "}
                {!a || !b
                  ? "未取得"
                  : a.reviewReady && b.reviewReady
                    ? "目安到達・UX確認が必要"
                    : "サンプル不足"}
              </caption>
              <thead>
                <tr>
                  <th>指標</th>
                  <th>A</th>
                  <th>B</th>
                  <th>差分 B−A</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["計測表示", a?.views, b?.views],
                  ["割当数", a?.assignments, b?.assignments],
                  ["広告対象", a?.adEligible, b?.adEligible],
                  ["広告リクエスト", a?.adRequests, b?.adRequests],
                  ["filled", a?.adFilled, b?.adFilled],
                  ["unfilled", a?.adUnfilled, b?.adUnfilled],
                  ["表示率proxy", a?.adViewableProxyRate, b?.adViewableProxyRate],
                  ["25%到達", a?.body25Rate, b?.body25Rate],
                  ["50%到達", a?.body50Rate, b?.body50Rate],
                  ["75%到達", a?.body75Rate, b?.body75Rate],
                  ["90%到達", a?.body90Rate, b?.body90Rate],
                  ["本文末到達", a?.bodyEndRate, b?.bodyEndRate],
                  ["次記事回遊", a?.nextArticleRate, b?.nextArticleRate],
                  ["可視時間ms/表示", a?.visibleMsPerView, b?.visibleMsPerView],
                  ["計測日数", a?.measuredDays, b?.measuredDays],
                ].map(([label, av, bv]) => (
                  <tr key={String(label)}>
                    <th>{label}</th>
                    <td>{number(av as number | undefined)}</td>
                    <td>{number(bv as number | undefined)}</td>
                    <td>{av != null && bv != null ? number(Number(bv) - Number(av)) : "未取得"}</td>
                  </tr>
                ))}
                {["LCP", "INP", "CLS"].map((v) => (
                  <tr key={v}>
                    <th>{v} p75区分</th>
                    <td>{a?.vitals.find((x) => x.vital === v)?.p75Band ?? "未取得"}</td>
                    <td>{b?.vitals.find((x) => x.vital === v)?.p75Band ?? "未取得"}</td>
                    <td>区分比較</td>
                  </tr>
                ))}
                <tr>
                  <th>公式推定収益</th>
                  <td>未取得</td>
                  <td>未取得</td>
                  <td>未取得</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      <p>
        取得状態:{" "}
        {data?.current.find((s) => s.source === "ga4")?.provisional
          ? "暫定"
          : data
            ? "取得済み（欠損・サンプル数は各行参照）"
            : "未取得"}
        。収益だけで採用を勧めず、到達・回遊・速度を併せて確認してください。
      </p>
    </>
  );
}
