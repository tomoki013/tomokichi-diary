import { useMemo, useState } from "react";
import {
  adAuditLabels,
  auditArticles,
  autoFixKinds,
  targetFor,
  testDay,
  TEST_MIN_DAYS,
  type AffiliateOffer,
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
          { value: "articles", label: "記事の広告" },
          { value: "tests", label: "位置テスト" },
          { value: "offers", label: "アフィリエイト" },
          { value: "settings", label: "設定" },
        ]}
      />
      {tab === "articles" && <ArticleAds />}
      {tab === "tests" && <Tests />}
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

/**
 * Every article against the ad standard. The ones that drifted can be put
 * right in one go: each is fixed and published on its own, then the site is
 * rebuilt once.
 */
function ArticleAds() {
  const overview = useOp("ads.overview");
  const articles = useOp("article.list");
  const { busy, run } = useAction();
  const audit = useMemo(
    () => (overview.data && articles.data ? auditArticles(articles.data.items, overview.data) : []),
    [overview.data, articles.data],
  );
  const fixable = audit.filter((a) => a.fixable && autoFixKinds.includes(a.kind));
  async function fixAll() {
    if (!confirmed(`${fixable.length}件の広告を標準に揃えて公開します。よろしいですか？`)) return;
    await run(
      "fix",
      async () => {
        for (const item of fixable) {
          await op("ads.setLayout", { articleId: item.article.id, layout: targetFor(item.kind) });
          await op("article.publish", { articleId: item.article.id, deferBuild: true });
        }
        await op("publication.run");
      },
      {
        done: "揃えて公開しました。サイトに反映しています",
        touches: ["ads", "article", "publication"],
      },
    );
  }
  if (!overview.data || !articles.data) return <Loaded resource={overview}>{() => null}</Loaded>;
  return (
    <>
      <p className="muted">公開中で広告がある記事 {overview.data.publishedAdArticles}本</p>
      {fixable.length > 0 && (
        <div className="spread">
          <span>{fixable.length}件が標準からずれています</span>
          <Button kind="primary" busy={busy === "fix"} onClick={() => void fixAll()}>
            まとめて揃えて公開
          </Button>
        </div>
      )}
      <Rows>
        {audit
          .filter((a) => a.kind !== "not-live")
          .toSorted((a, b) => Number(b.fixable) - Number(a.fixable))
          .map((item) => {
            const label = adAuditLabels[item.kind];
            return (
              <Row
                key={item.article.id}
                href={href.article(item.article.id)}
                title={item.article.title}
                aside={<Badge tone={label.tone}>{label.label}</Badge>}
              />
            );
          })}
      </Rows>
    </>
  );
}

function Tests() {
  const overview = useOp("ads.overview");
  const articles = useOp("article.list");
  const { busy, run } = useAction();
  const titleOf = (id: string) => articles.data?.items.find((a) => a.id === id)?.title ?? id;
  return (
    <Loaded resource={overview}>
      {(data) => {
        const tests = data.experiments.toSorted((a, b) =>
          (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
        );
        return tests.length === 0 ? (
          <Empty>位置テストはまだありません。記事の「広告」から始められます。</Empty>
        ) : (
          <Rows>
            {tests.map((test) => (
              <Row
                key={test.id}
                title={titleOf(test.articleId)}
                meta={
                  test.status === "running"
                    ? `${testDay(test)}日目${testDay(test) < TEST_MIN_DAYS ? `（${TEST_MIN_DAYS}日以上で判断）` : ""} · B ${test.shareB}%`
                    : test.status === "stopped"
                      ? `終了 ${test.stoppedAt?.slice(0, 10) ?? ""}`
                      : "下書き"
                }
                aside={
                  test.status === "running" ? (
                    <Button
                      busy={busy === test.id}
                      onClick={() =>
                        confirmed("このテストを終了します。再開はできません。") &&
                        void run(
                          test.id,
                          () =>
                            op("ads.controlExperiment", { experimentId: test.id, action: "stop" }),
                          {
                            done: "終了しました",
                            touches: ["ads"],
                          },
                        )
                      }
                    >
                      終了
                    </Button>
                  ) : (
                    <Badge>{test.status === "stopped" ? "終了" : "下書き"}</Badge>
                  )
                }
              />
            ))}
          </Rows>
        );
      }}
    </Loaded>
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
  const flag = (
    key: "adsEnabled" | "placementsEnabled" | "experimentsEnabled" | "affiliateEnabled",
    label: string,
  ) => (
    <Check
      label={label}
      checked={form[key]}
      onChange={(on) => setForm((f) => ({ ...f, [key]: on }))}
    />
  );
  return (
    <Panel title="サイト全体の設定">
      {flag("adsEnabled", "広告を出す")}
      {flag("placementsEnabled", "記事ごとの広告配置を使う")}
      {flag("experimentsEnabled", "位置テストを使う")}
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
            done: "保存しました",
            touches: ["ads"],
          })
        }
      >
        保存
      </Button>
    </Panel>
  );
}
