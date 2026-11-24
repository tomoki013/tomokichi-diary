import { useState } from "react";
import {
  type AffiliateOffer,
  type AnchorTestCohort,
  type MonetizationOverviewDto,
  type MonetizationSettings,
} from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import {
  Badge,
  Button,
  Check,
  Empty,
  Loaded,
  Page,
  Panel,
  Row,
  Rows,
  Select,
  Tabs,
  TextArea,
  TextInput,
  confirmed,
} from "../../ui/parts";

type Tab = "articles" | "tests" | "offers" | "settings";

/** Ads across the site: which articles follow the standard, tests, affiliate offers, settings. */
export function Ads() {
  useTitle("収益化");
  const [tab, setTab] = useState<Tab>("articles");
  const overview = useOp("ads.overview");
  return (
    <Page title="収益化" back={{ href: href.more(), label: "その他" }}>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "articles", label: "基本配置" },
          { value: "tests", label: "アンカー広告テスト" },
          { value: "offers", label: "アフィリエイト" },
          { value: "settings", label: "設定" },
        ]}
      />
      {tab === "articles" && (
        <Loaded resource={overview}>{(data) => <ArticleAds data={data} />}</Loaded>
      )}
      {tab === "tests" && <Loaded resource={overview}>{(data) => <Tests data={data} />}</Loaded>}
      {tab === "offers" && (
        <Loaded resource={overview}>{(data) => <Offers offers={data.offers} />}</Loaded>
      )}
      {tab === "settings" && (
        <Loaded resource={overview}>
          {(data) => <Settings key={data.settings.updatedAt ?? "s"} settings={data.settings} />}
        </Loaded>
      )}
    </Page>
  );
}

function ArticleAds({ data }: { data: MonetizationOverviewDto }) {
  const articles = useOp("article.list");
  return (
    <>
      <Panel title="公開記事の基本配置" hint={data.settings.adsEnabled ? "広告オン" : "広告オフ"}>
        <p>
          本文中に1枠、記事末尾に1枠を置きます。本文が短いなど、広告を置ける段落がない記事は末尾の1枠だけです。
        </p>
        <p className="muted">
          対象は広告が有効な公開記事{data.publishedAdArticles}
          本です。新しく公開する記事にもこのルールを使います。
        </p>
      </Panel>
      <Loaded resource={articles}>
        {({ items }) => {
          const excluded = new Set(
            data.articles.filter((a) => a.published?.enabled === false).map((a) => a.articleId),
          );
          const exceptions = items.filter(
            (a) => a.kind === "article" && a.isLive && excluded.has(a.id),
          );
          return (
            <Panel title="個別に広告を外している記事" hint={`${exceptions.length}本`} collapsible>
              {exceptions.length ? (
                <Rows>
                  {exceptions.map((a) => (
                    <Row key={a.id} title={a.title} href={href.article(a.id)} />
                  ))}
                </Rows>
              ) : (
                <Empty>すべての公開記事が基本配置の対象です。</Empty>
              )}
            </Panel>
          );
        }}
      </Loaded>
    </>
  );
}

const reportDay = (ago: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - ago * 86_400_000));

const metricRows = [
  { key: "views", label: "計測表示数", scale: 1, unit: "回", difference: "回", digits: 0 },
  {
    key: "bodyEndRate",
    label: "読了率（本文末到達）",
    scale: 100,
    unit: "%",
    difference: " pt",
    digits: 1,
  },
  {
    key: "visibleMsPerView",
    label: "平均可視滞在時間",
    scale: 0.001,
    unit: "秒",
    difference: "秒",
    digits: 1,
  },
  {
    key: "nextArticleRate",
    label: "次の記事への移動率",
    scale: 100,
    unit: "%",
    difference: " pt",
    digits: 1,
  },
  { key: "measuredDays", label: "計測日数", scale: 1, unit: "日", difference: "日", digits: 0 },
] as const;

function Tests({ data }: { data: MonetizationOverviewDto }) {
  const { busy, run } = useAction();
  const [days, setDays] = useState("28");
  const [device, setDevice] = useState<AnchorTestCohort["device"]>("all");
  const dashboard = useOp("analytics.dashboard", {
    start: reportDay(Number(days)),
    end: reportDay(1),
    sections: ["anchorTest"],
  });
  const active = data.settings.anchorExperimentEnabled ?? true;
  return (
    <>
      <Panel
        title="アンカー広告の有無"
        hint={
          <Badge tone={active && data.settings.adsEnabled ? "ok" : "neutral"}>
            {!data.settings.adsEnabled ? "広告全体がオフ" : active ? "設定オン" : "設定オフ"}
          </Badge>
        }
      >
        <p>
          広告が有効な公開記事で、表示ごとに半数ずつ割り当てます。Aは基本配置、Bは同じ配置に画面下のアンカー広告を追加します。短い記事も対象です。
        </p>
        <div className="inline">
          <Button
            busy={busy === "test"}
            onClick={() =>
              void run(
                "test",
                () =>
                  op("ads.saveSettings", {
                    settings: { ...data.settings, anchorExperimentEnabled: !active },
                  }),
                {
                  done: "設定を保存しました。反映状況は「サイト反映」で確認できます",
                  touches: ["ads", "publication"],
                },
              )
            }
          >
            {active ? "テストを停止" : "テストを開始"}
          </Button>
          <a href={href.site()}>サイト反映</a>
        </div>
      </Panel>
      <Panel title="読まれ方の比較">
        <div className="inline">
          <Select
            label="集計期間"
            value={days}
            onChange={setDays}
            options={[
              { value: "7", label: "直近7日" },
              { value: "14", label: "直近14日" },
              { value: "28", label: "直近28日" },
            ]}
          />
          <Select
            label="端末"
            value={device}
            onChange={setDevice}
            options={[
              { value: "all", label: "すべて" },
              { value: "mobile", label: "スマートフォン" },
              { value: "desktop", label: "パソコン" },
              { value: "tablet", label: "タブレット" },
            ]}
          />
        </div>
        <Loaded resource={dashboard}>
          {({ dashboard: result }) => {
            const rows = result.anchorTest ?? [];
            const a = rows.find((r) => r.device === device && r.variant === "A");
            const b = rows.find((r) => r.device === device && r.variant === "B");
            const enough = [a, b].every((r) => r && r.views >= 200 && r.measuredDays >= 14);
            return (
              <>
                <p className="muted">
                  {result.range.start} 〜 {result.range.end}（米国太平洋時間）
                </p>
                {!a && !b ? (
                  <Empty>この期間・端末のアンカー広告テストの計測値はまだありません。</Empty>
                ) : (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">指標</th>
                            <th scope="col">A なし</th>
                            <th scope="col">B あり</th>
                            <th scope="col">差（B − A）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metricRows.map(({ key, label, scale, unit, difference, digits }) => {
                            const left = a?.[key],
                              right = b?.[key];
                            const format = (value: number | undefined | null, diff = false) =>
                              value == null
                                ? "—"
                                : (value * scale).toLocaleString("ja-JP", {
                                    maximumFractionDigits: digits,
                                    signDisplay: diff ? "exceptZero" : "auto",
                                  }) + (diff ? difference : unit);
                            return (
                              <tr key={key}>
                                <th scope="row">{label}</th>
                                <td>{format(left)}</td>
                                <td>{format(right)}</td>
                                <td>
                                  {format(
                                    left != null && right != null ? right - left : null,
                                    true,
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {!enough && (
                      <p className="muted">
                        計測中です。各群200表示・14計測日を比較の目安にしてください。
                      </p>
                    )}
                    <p className="muted">
                      読了率は計測表示のうち本文末に到達した割合です。可視滞在時間はページが画面に出ていた時間を計測表示数で割った値です。Bには広告が配信されなかった表示も含みます。
                    </p>
                  </>
                )}
              </>
            );
          }}
        </Loaded>
      </Panel>
    </>
  );
}

const blankOffer = (): Omit<AffiliateOffer, "id"> => ({
  name: "",
  provider: "",
  category: "",
  heading: "",
  description: "",
  imageUrl: null,
  url: null,
  format: "text",
  notes: "",
  status: "draft",
  checkedAt: null,
  publicationApproved: false,
  updatedAt: null,
});

function Offers({ offers }: { offers: readonly AffiliateOffer[] }) {
  const [editing, setEditing] = useState<AffiliateOffer | Omit<AffiliateOffer, "id"> | null>(null);
  const active = offers.filter((o) => o.status !== "archived");
  return (
    <>
      <Button kind="primary" onClick={() => setEditing(blankOffer())}>
        案件を登録
      </Button>
      {active.length === 0 ? (
        <Empty>登録した案件はありません。</Empty>
      ) : (
        <Rows>
          {active.map((offer) => (
            <Row
              key={offer.id}
              onClick={() => setEditing(offer)}
              title={offer.name}
              meta={`${offer.provider} · ${offer.category}`}
              aside={
                <Badge tone={offer.publicationApproved ? "ok" : "neutral"}>
                  {offer.publicationApproved ? "掲載可" : offer.status}
                </Badge>
              }
            />
          ))}
        </Rows>
      )}
      {editing && (
        <OfferForm
          key={"id" in editing ? editing.id : "new"}
          offer={editing}
          onDone={() => setEditing(null)}
        />
      )}
    </>
  );
}

function OfferForm({
  offer,
  onDone,
}: {
  offer: AffiliateOffer | Omit<AffiliateOffer, "id">;
  onDone: () => void;
}) {
  const [form, setForm] = useState(offer);
  const { busy, run } = useAction();
  const set = (change: Partial<AffiliateOffer>) => setForm((f) => ({ ...f, ...change }));
  const existing = "id" in form;
  async function save() {
    const checkedAt =
      form.publicationApproved && !form.checkedAt ? new Date().toISOString() : form.checkedAt;
    const done = await run(
      "save",
      () =>
        existing
          ? op("offer.update", { offer: { ...(form as AffiliateOffer), checkedAt } })
          : op("offer.create", { offer: { ...form, checkedAt } }),
      { done: "保存しました", touches: ["ads"] },
    );
    if (done) onDone();
  }
  return (
    <dialog open className="sheet" aria-label="アフィリエイト案件">
      <div className="sheet__body">
        <div className="spread">
          <h2>{existing ? form.name : "新しい案件"}</h2>
          <Button kind="quiet" onClick={onDone}>
            閉じる
          </Button>
        </div>
        <TextInput
          label="管理用の名前"
          value={form.name}
          onChange={(name) => set({ name })}
          max={150}
        />
        <div className="inline">
          <TextInput
            label="ASP・提供元"
            value={form.provider}
            onChange={(provider) => set({ provider })}
          />
          <TextInput
            label="分類"
            value={form.category}
            onChange={(category) => set({ category })}
          />
        </div>
        <TextInput
          label="見出し"
          value={form.heading}
          onChange={(heading) => set({ heading })}
          max={200}
        />
        <TextArea
          label="説明"
          value={form.description}
          onChange={(description) => set({ description })}
          max={2000}
          rows={3}
        />
        <TextInput
          label="提携 URL"
          type="url"
          value={form.url ?? ""}
          onChange={(url) => set({ url: url || null })}
        />
        <TextInput
          label="画像 URL"
          type="url"
          value={form.imageUrl ?? ""}
          onChange={(imageUrl) => set({ imageUrl: imageUrl || null })}
        />
        <Select
          label="表示形式"
          value={form.format}
          options={[
            { value: "text", label: "テキスト" },
            { value: "booking_card", label: "予約カード" },
            { value: "photo_card", label: "写真カード" },
          ]}
          onChange={(format) => set({ format })}
        />
        <Select
          label="状態"
          value={form.status}
          options={[
            { value: "draft", label: "準備中" },
            { value: "ready", label: "掲載準備済み" },
            { value: "paused", label: "停止" },
          ]}
          onChange={(status) => set({ status })}
        />
        <Check
          label="掲載を承認する（記事の公開で配信されます）"
          checked={form.publicationApproved ?? false}
          onChange={(publicationApproved) => set({ publicationApproved })}
        />
        <TextArea
          label="メモ"
          value={form.notes}
          onChange={(notes) => set({ notes })}
          max={4000}
          rows={2}
        />
        <div className="inline">
          <Button
            kind="primary"
            busy={busy === "save"}
            disabled={!form.name}
            onClick={() => void save()}
          >
            保存
          </Button>
          {existing && (
            <Button
              kind="danger"
              busy={busy === "archive"}
              onClick={async () => {
                if (!confirmed("この案件を一覧から外します（配置は残ります）。")) return;
                const done = await run(
                  "archive",
                  () => op("offer.archive", { offerId: (form as AffiliateOffer).id }),
                  {
                    done: "外しました",
                    touches: ["ads"],
                  },
                );
                if (done) onDone();
              }}
            >
              一覧から外す
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}

function Settings({ settings }: { settings: MonetizationSettings }) {
  const [form, setForm] = useState(settings);
  const [unitId, setUnitId] = useState("");
  const [unitName, setUnitName] = useState("");
  const { busy, run } = useAction();
  const flag = (key: "adsEnabled" | "affiliateEnabled", label: string) => (
    <Check
      label={label}
      checked={form[key]}
      onChange={(on) => setForm((f) => ({ ...f, [key]: on }))}
    />
  );
  return (
    <Panel title="サイト全体の設定">
      {flag("adsEnabled", "公開記事に広告を出す")}
      {flag("affiliateEnabled", "アフィリエイトを出す")}
      <h3>広告ユニット</h3>
      <Rows>
        {form.adUnits.map((unit) => (
          <Row
            key={unit.id}
            title={unit.name}
            meta={unit.id}
            aside={
              <Button
                kind="quiet"
                onClick={() =>
                  setForm((f) => ({ ...f, adUnits: f.adUnits.filter((u) => u.id !== unit.id) }))
                }
              >
                外す
              </Button>
            }
          />
        ))}
      </Rows>
      <div className="inline">
        <TextInput label="ユニット ID" value={unitId} onChange={setUnitId} />
        <TextInput label="名前" value={unitName} onChange={setUnitName} />
        <Button
          disabled={!/^\d+$/.test(unitId) || !unitName}
          onClick={() => {
            setForm((f) => ({ ...f, adUnits: [...f.adUnits, { id: unitId, name: unitName }] }));
            setUnitId("");
            setUnitName("");
          }}
        >
          追加
        </Button>
      </div>
      <Button
        kind="primary"
        busy={busy === "save"}
        onClick={() =>
          void run("save", () => op("ads.saveSettings", { settings: form }), {
            done: "設定を保存しました",
            touches: ["ads", "publication"],
          })
        }
      >
        保存
      </Button>
    </Panel>
  );
}
