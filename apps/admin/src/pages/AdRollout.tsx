import { useState } from "react";
import type {
  AnalyticsDashboardDto,
  ArticleSummaryDto,
  MonetizationOverviewDto,
} from "@tomokichi/contracts";
import { describeError } from "../lib/api";
import { prepareAdRollout, previewAdRollout, type AdRolloutPlan } from "../lib/ad-rollout";
import { publishSelection } from "../lib/bulk-publish";
import { href } from "../lib/route";
import { Panel } from "../ui/parts";

export function AdRollout({
  articles,
  overview,
  analytics,
  onBusy,
  blocked,
  reload,
}: {
  articles: readonly ArticleSummaryDto[];
  overview: MonetizationOverviewDto;
  analytics?: AnalyticsDashboardDto;
  onBusy: (v: boolean) => void;
  blocked: boolean;
  reload: () => Promise<void>;
}) {
  const [plans, setPlans] = useState<AdRolloutPlan[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<{ title: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; result: string }[]>([]);
  const enabled =
    overview.settings.adsEnabled &&
    overview.settings.placementsEnabled &&
    overview.settings.experimentsEnabled;
  async function preview() {
    setBusy(true);
    onBusy(true);
    setResults([]);
    try {
      const result = await previewAdRollout(articles, overview, (n) =>
        setMessage(`${n}記事の本文を確認中…`),
      );
      const traffic = (id: string) =>
        analytics?.pages.ga4.find((p) => p.articleId === id)?.metrics["pageViews"] ?? 0;
      setPlans(
        result.plans.toSorted(
          (a, b) => (traffic(b.article.id) ?? 0) - (traffic(a.article.id) ?? 0),
        ),
      );
      setSkipped(result.skipped);
      setSelected(new Set());
      setMessage(
        `${result.plans.length}記事で位置候補が見つかりました。対象と位置を確認して選択してください。`,
      );
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    onBusy(true);
    const outcomes: { id: string; title: string; result: string }[] = [];
    const ready: ArticleSummaryDto[] = [];
    for (const plan of plans.filter((p) => selected.has(p.article.id))) {
      setMessage(`${outcomes.length + 1}/${selected.size}記事の実験を準備中…`);
      try {
        ready.push((await prepareAdRollout(plan)).article);
        outcomes.push({ id: plan.article.id, title: plan.article.title, result: "準備済み" });
      } catch (e) {
        outcomes.push({
          id: plan.article.id,
          title: plan.article.title,
          result: `未公開のまま確認が必要: ${describeError(e)}`,
        });
      }
      setResults([...outcomes]);
    }
    try {
      if (ready.length) {
        const result = await publishSelection(ready, (n) =>
          setMessage(`${n}/${ready.length}記事の公開版を作成中…`),
        );
        for (const item of result.items) {
          const outcome = outcomes.find((o) => o.id === item.article.id)!;
          outcome.result = item.published
            ? "公開版作成済み・サイト反映待ち"
            : `公開できませんでした: ${item.error}`;
        }
        setMessage(
          result.buildError
            ? `配信の再試行が必要: ${result.buildError}`
            : `${result.items.filter((i) => i.published).length}記事の公開を受け付けました。記事一覧でサイト反映完了を確認してください。`,
        );
      } else setMessage("公開した記事はありません。各記事の結果を確認してください。");
      setResults([...outcomes]);
      setSelected(new Set());
      await reload();
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <Panel title="複数記事へ配置テストを展開">
      <p>
        公開中で未公開の変更・個別設定・既存実験がない記事を調べます。本文の30〜65%（40%付近を優先）の段落後を候補にし、画像・埋め込み・関連記事の隣は避けます。条件に合わない記事はスキップします。
      </p>
      <p>
        Aは末尾1枠、Bは本文1枠、50:50。本文・SEOは維持し、配置マーカーだけ追加します。アフィリエイトは無効です。
      </p>
      <button type="button" disabled={blocked || busy || !enabled} onClick={() => void preview()}>
        対象記事と挿入位置をプレビュー
      </button>
      {blocked && <p>個別実験の未保存の変更を先に保存してください。</p>}
      {!enabled && <p>広告設定で個別配置と実験を有効にしてください。</p>}
      <output className="ad-rollout-status" aria-live="polite">
        {message}
      </output>
      {plans.length > 0 && (
        <>
          <label className="field">
            <input
              type="checkbox"
              disabled={busy}
              checked={plans.length === selected.size}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(plans.map((p) => p.article.id)) : new Set())
              }
            />
            候補をすべて選択（{plans.length}記事）
          </label>
          <button
            type="button"
            disabled={blocked || busy || !selected.size || results.length > 0}
            onClick={() => void run()}
          >
            選択した{selected.size}記事の実験を開始して公開
          </button>
          <div className="analytics-table ad-rollout-table">
            <table>
              <caption>記事と本文内の挿入位置</caption>
              <thead>
                <tr>
                  <th>対象</th>
                  <th>記事</th>
                  <th>この段落の後</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.article.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={p.article.title}
                        disabled={busy || results.some((r) => r.id === p.article.id)}
                        checked={selected.has(p.article.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.add(p.article.id);
                            else next.delete(p.article.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <a href={href.article(p.article.id)}>{p.article.title}</a>
                      <br />
                      本文の約{Math.round(p.fraction * 100)}%
                    </td>
                    <td>{p.excerpt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {results.length > 0 && (
        <ul>
          {results.map((r) => (
            <li key={r.id}>
              <a href={href.article(r.id)}>{r.title}</a>：{r.result}
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <details>
          <summary>位置候補がない・取得できなかった記事（{skipped.length}）</summary>
          <ul>
            {skipped.map((s) => (
              <li key={s.title}>
                {s.title}：{s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p>
        <a href={href.articles()}>記事一覧で公開状態を確認 →</a>
        。失敗した記事は自動公開せず、既存の公開版を維持します。
      </p>
    </Panel>
  );
}
