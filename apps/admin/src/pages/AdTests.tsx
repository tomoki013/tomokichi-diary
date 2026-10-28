import { useState } from "react";
import type {
  AnalyticsDashboardDto,
  ArticleSummaryDto,
  MonetizationOverviewDto,
} from "@tomokichi/contracts";
import {
  canStartTest,
  defaultCondition,
  prepareAdTest,
  TEST_MIN_DAYS,
  type AdTestCondition,
} from "../lib/ad-test";
import { describeError } from "../lib/api";
import { publishSelection } from "../lib/bulk-publish";
import { href } from "../lib/route";
import { Panel } from "../ui/parts";

/**
 * Builds a placement test from a condition and a choice of articles. Markers,
 * IDs and the order of saves come from `lib/ad-test.ts`; the author only
 * decides what to compare and where.
 */
export function AdTests({
  articles,
  overview,
  analytics,
  blocked,
  onBusy,
  reload,
}: {
  articles: readonly ArticleSummaryDto[];
  overview: MonetizationOverviewDto;
  analytics?: AnalyticsDashboardDto;
  blocked: boolean;
  onBusy: (busy: boolean) => void;
  reload: () => Promise<void>;
}) {
  const units = overview.settings.adUnits;
  const [condition, setCondition] = useState<AdTestCondition>(() => defaultCondition(units[0]?.id));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failures, setFailures] = useState<{ id: string; title: string; error: string }[]>([]);
  const views = (id: string) =>
    Number(analytics?.pages.ga4.find((p) => p.articleId === id)?.metrics["pageViews"] ?? 0);
  const candidates = articles
    .filter((a) => canStartTest(a, overview))
    .toSorted((a, b) => views(b.id) - views(a.id));
  const enabled =
    overview.settings.adsEnabled &&
    overview.settings.placementsEnabled &&
    overview.settings.experimentsEnabled;
  const set = (patch: Partial<AdTestCondition>) => setCondition((c) => ({ ...c, ...patch }));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function run() {
    const chosen = candidates.filter((a) => selected.has(a.id));
    if (
      !chosen.length ||
      !confirm(
        `${chosen.length}記事でテストを開始して公開します。\nA ${100 - condition.shareB}%：末尾のみ / B ${condition.shareB}%：末尾＋本文中\n本文中の広告がない記事は、標準ルールの位置に追加してから開始します。`,
      )
    )
      return;
    setBusy(true);
    onBusy(true);
    setFailures([]);
    const ready: ArticleSummaryDto[] = [];
    const failed: { id: string; title: string; error: string }[] = [];
    try {
      for (const [i, article] of chosen.entries()) {
        setMessage(`${i + 1}/${chosen.length} 記事のテストを準備中…`);
        try {
          ready.push(await prepareAdTest(article, overview, condition));
        } catch (error) {
          failed.push({ id: article.id, title: article.title, error: describeError(error) });
        }
      }
      if (ready.length) {
        const result = await publishSelection(ready, (n) =>
          setMessage(`${n}/${ready.length} 記事を公開中…`),
        );
        for (const item of result.items.filter((i) => !i.published))
          failed.push({
            id: item.article.id,
            title: item.article.title,
            error: item.error ?? "公開できませんでした",
          });
        setMessage(
          `${result.items.filter((i) => i.published).length}記事でテストを開始しました。サイト反映後から計測されます。` +
            (result.buildError
              ? `（サイトへの反映を開始できませんでした：${result.buildError}）`
              : ""),
        );
      } else setMessage("開始できた記事はありません。");
      setFailures(failed);
      setSelected(new Set());
      await reload();
    } catch (error) {
      setMessage(describeError(error));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <Panel title="テストを作る">
      <p className="muted small">
        A＝記事末尾の広告だけ、B＝末尾＋本文中の広告。読者ごとにランダムで振り分けます。目安は
        {TEST_MIN_DAYS}
        日・各パターン200表示です。終わったテストは「広告配置」から標準に戻せ、同じ記事で何度でも新しいテストを作れます。
      </p>
      {!enabled && (
        <p className="notice notice--warn">
          広告設定で「個別配置」と「配置実験」を有効にしてください。
        </p>
      )}
      <fieldset className="test-condition" disabled={busy || !enabled}>
        <legend>条件</legend>
        <label className="field">
          <span>テスト名</span>
          <input
            value={condition.name}
            maxLength={60}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>
            振り分け A {100 - condition.shareB}% / B {condition.shareB}%
          </span>
          <input
            type="range"
            min={10}
            max={90}
            step={10}
            value={condition.shareB}
            onChange={(e) => set({ shareB: Number(e.target.value) })}
          />
        </label>
        {(["adUnitA", "adUnitB"] as const).map((key) => (
          <label className="field" key={key}>
            <span>{key === "adUnitA" ? "Aの広告ユニット" : "Bの広告ユニット"}</span>
            <select value={condition[key]} onChange={(e) => set({ [key]: e.target.value })}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        {condition.adUnitA === condition.adUnitB && (
          <p className="muted small">
            同じユニットでは公式収益をA/B別に取れません。表示・可視・読了で比べます。
          </p>
        )}
      </fieldset>

      <div className="row test-pick">
        <strong>対象の記事</strong>
        <span className="muted small">
          公開中・変更なし・テスト中でない{candidates.length}記事（PV順）
        </span>
        <button
          type="button"
          className="link"
          disabled={busy}
          onClick={() => setSelected(new Set(candidates.slice(0, 10).map((a) => a.id)))}
        >
          PV上位10記事
        </button>
        <button
          type="button"
          className="link"
          disabled={busy}
          onClick={() => setSelected(new Set())}
        >
          選択を解除
        </button>
      </div>
      <ul className="test-articles">
        {candidates.map((a) => (
          <li key={a.id}>
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={selected.has(a.id)}
                onChange={(e) => toggle(a.id, e.target.checked)}
              />
              <span>{a.title || a.slug}</span>
            </label>
            {analytics && (
              <span className="muted small nowrap">{views(a.id).toLocaleString()} PV</span>
            )}
          </li>
        ))}
      </ul>

      {failures.length > 0 && (
        <ul className="problems">
          {failures.map((f) => (
            <li key={f.id}>
              <a href={href.article(f.id)}>{f.title}</a>：{f.error}
            </li>
          ))}
        </ul>
      )}
      <div className="bulk-bar" aria-live="polite">
        <span className="bulk-bar__all">
          {message ||
            (selected.size ? `${selected.size}記事を選択中` : "テストする記事を選んでください")}
        </span>
        <button
          type="button"
          className="primary"
          disabled={busy || blocked || !enabled || !selected.size}
          onClick={() => void run()}
        >
          {busy ? "処理中…" : `テストを開始して公開（${selected.size}）`}
        </button>
      </div>
    </Panel>
  );
}
