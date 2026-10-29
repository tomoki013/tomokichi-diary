import { useMemo, useState } from "react";
import type { ArticleSummaryDto, MonetizationOverviewDto } from "@tomokichi/contracts";
import {
  adAuditLabels,
  auditArticles,
  autoFixKinds,
  adLayoutLabels,
  prepareLayout,
  targetFor,
  type AdAuditKind,
} from "../lib/ad-standard";
import { api, describeError } from "../lib/api";
import { TEST_MIN_DAYS, testDay } from "../lib/ad-test";
import { publishSelection } from "../lib/bulk-publish";
import { href } from "../lib/route";
import { Badge, EmptyState, Panel } from "../ui/parts";

const ORDER: AdAuditKind[] = [
  "missing-body",
  "end-stopped",
  "test-ended",
  "testing",
  "off",
  "end-only",
  "standard",
  "unpublished",
  "not-live",
];

interface Outcome {
  id: string;
  title: string;
  tone: "ok" | "warn" | "danger";
  text: string;
}

/**
 * Every article against the one standard layout, and one button to bring the
 * chosen ones to it. Positions, statuses and units are decided by the rule in
 * `lib/ad-standard.ts`; the author only chooses which articles.
 */
export function AdPlacements({
  articles,
  overview,
  onBusy,
  reload,
}: {
  articles: readonly ArticleSummaryDto[];
  overview: MonetizationOverviewDto;
  onBusy: (busy: boolean) => void;
  reload: () => Promise<void>;
}) {
  const audit = useMemo(() => auditArticles(articles, overview), [articles, overview]);
  const [filter, setFilter] = useState<AdAuditKind | "fix">("fix");
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        audit
          .filter(
            (a) =>
              autoFixKinds.includes(a.kind) ||
              (a.kind === "testing" &&
                testDay({ startedAt: a.startedAt ?? null }) >= TEST_MIN_DAYS),
          )
          .map((a) => a.article.id),
      ),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const count = (kind: AdAuditKind) => audit.filter((a) => a.kind === kind).length;
  const visible = audit
    .filter((a) => (filter === "fix" ? a.fixable : a.kind === filter))
    .toSorted((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const chosen = audit.filter((a) => a.fixable && selected.has(a.article.id));
  const setMany = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function run() {
    if (!chosen.length) return;
    const ending = chosen.filter((a) => a.kind === "testing").length;
    const endOnly = chosen.filter((a) => targetFor(a.kind) === "end-only").length;
    if (
      !confirm(
        [
          `${chosen.length}記事の広告を揃えて公開します。`,
          `・末尾＋本文中：${chosen.length - endOnly}記事（本文が短い記事は末尾のみ）`,
          endOnly ? `・末尾のみ：${endOnly}記事（広告オフだった記事）` : "",
          ending ? `・A/Bテスト中の${ending}記事はテストを終了します` : "",
          "本文は広告マーカーの追加・移動以外変わりません。",
        ]
          .filter(Boolean)
          .join("\n"),
      )
    )
      return;
    setBusy(true);
    onBusy(true);
    const results: Outcome[] = [];
    const ready: ArticleSummaryDto[] = [];
    try {
      for (const [i, item] of chosen.entries()) {
        setMessage(`${i + 1}/${chosen.length} 記事を準備中…`);
        try {
          const { article, changes } = await prepareLayout(
            item.article,
            overview,
            targetFor(item.kind),
            api,
          );
          if (changes.length) ready.push(article);
          results.push({
            id: item.article.id,
            title: item.article.title,
            tone: "ok",
            text: changes.length ? changes.join("・") : "変更なし（すでに標準）",
          });
        } catch (error) {
          results.push({
            id: item.article.id,
            title: item.article.title,
            tone: "warn",
            text: `公開せず保留：${describeError(error)}`,
          });
        }
        setOutcomes([...results]);
      }
      if (ready.length) {
        const published = await publishSelection(ready, (n) =>
          setMessage(`${n}/${ready.length} 記事を公開中…`),
        );
        for (const item of published.items.filter((i) => !i.published)) {
          const outcome = results.find((r) => r.id === item.article.id);
          if (outcome)
            Object.assign(outcome, { tone: "danger", text: `公開できませんでした：${item.error}` });
        }
        setOutcomes([...results]);
        setMessage(
          published.buildError
            ? `公開版は作成しました。サイトへの反映を開始できませんでした：${published.buildError}（記事一覧から再試行できます）`
            : `${published.items.filter((i) => i.published).length}記事を公開しました。サイトへの反映には数分かかります。`,
        );
      } else setMessage("公開が必要な記事はありませんでした。");
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
    <Panel title="広告配置">
      <div className="ad-rule">
        <p>
          <strong>標準ルール</strong>
          ：記事末尾に1枠、本文中に1枠。本文中の位置は、見出しと、読者に見える本文600字以上の後・画像やカードから離れた段落を自動で選びます（すでに置いてある位置は維持）。アフィリエイト枠はそのまま残します。
        </p>
        <p className="muted small">
          A/Bテスト中の記事は目安の{TEST_MIN_DAYS}
          日を過ぎたものだけ最初から選択します（選ぶとテストを終了し、Bの本文中の位置をそのまま使います）。広告オフだった記事と、本文が短く置ける段落がない記事は「末尾のみ」にします。変更未公開・未公開の記事は、記事編集で公開するときに整えてください。
        </p>
      </div>

      <fieldset className="chips">
        <legend className="sr-only">状態で絞り込む</legend>
        <button
          type="button"
          className="chip"
          aria-pressed={filter === "fix"}
          onClick={() => setFilter("fix")}
        >
          揃えられる記事<span className="chip__count">{audit.filter((a) => a.fixable).length}</span>
        </button>
        {ORDER.map((kind) => (
          <button
            key={kind}
            type="button"
            className="chip"
            aria-pressed={filter === kind}
            disabled={!count(kind)}
            onClick={() => setFilter(kind)}
          >
            {adAuditLabels[kind].label}
            <span className="chip__count">{count(kind)}</span>
          </button>
        ))}
      </fieldset>

      {outcomes.length > 0 && (
        <details className="ad-results" open={!busy}>
          <summary>
            今回の結果（{outcomes.filter((o) => o.tone === "ok").length}/{outcomes.length}
            記事を処理）
          </summary>
          <ul>
            {outcomes.map((o) => (
              <li key={o.id}>
                <a href={href.article(o.id)}>{o.title}</a>
                <span className={`ad-outcome ad-outcome--${o.tone}`}>{o.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {visible.length === 0 ? (
        <EmptyState>該当する記事はありません。</EmptyState>
      ) : (
        <table className="table ad-table">
          <thead>
            <tr>
              <th className="table__select">
                {visible.some((a) => a.fixable) && (
                  <input
                    type="checkbox"
                    aria-label="表示中の記事をすべて選択"
                    disabled={busy}
                    checked={visible
                      .filter((a) => a.fixable)
                      .every((a) => selected.has(a.article.id))}
                    onChange={(e) =>
                      setMany(
                        visible.filter((a) => a.fixable).map((a) => a.article.id),
                        e.target.checked,
                      )
                    }
                  />
                )}
              </th>
              <th>記事</th>
              <th>いまの広告</th>
              <th className="hide-narrow">揃えた後</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ article, kind, fixable, startedAt }) => {
              const outcome = outcomes.find((o) => o.id === article.id);
              return (
                <tr key={article.id}>
                  <td className="table__select">
                    {fixable && (
                      <input
                        type="checkbox"
                        aria-label={`${article.title}を選択`}
                        disabled={busy}
                        checked={selected.has(article.id)}
                        onChange={(e) => setMany([article.id], e.target.checked)}
                      />
                    )}
                  </td>
                  <td className="table__main">
                    <a className="table__title" href={href.article(article.id)}>
                      {article.title || article.slug}
                    </a>
                    {outcome && (
                      <span className={`ad-outcome ad-outcome--${outcome.tone}`}>
                        {outcome.text}
                      </span>
                    )}
                  </td>
                  <td className="nowrap">
                    <Badge tone={adAuditLabels[kind].tone}>{adAuditLabels[kind].label}</Badge>
                    {kind === "testing" && (
                      <span className="muted small">
                        {" "}
                        {testDay({ startedAt: startedAt ?? null })}/{TEST_MIN_DAYS}日
                      </span>
                    )}
                  </td>
                  <td className="nowrap muted small hide-narrow">
                    {fixable ? adLayoutLabels[targetFor(kind)] : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="bulk-bar" aria-live="polite">
        <span className="bulk-bar__all">
          {message ||
            (chosen.length ? `${chosen.length}記事を選択中` : "揃える記事を選んでください")}
        </span>
        <button
          type="button"
          className="primary"
          disabled={busy || !chosen.length}
          onClick={() => void run()}
        >
          {busy ? "処理中…" : `標準に揃えて公開（${chosen.length}）`}
        </button>
      </div>
    </Panel>
  );
}
