import { useCallback, useEffect, useState } from "react";
import type { ArticleKnowledgeBundleDto } from "@tomokichi/contracts";
import { api } from "../api";
import type { ToastMessage } from "./Toast";

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

export function KnowledgePanel({
  articleId,
  revisionId,
  notify,
  onError,
}: {
  articleId: string;
  revisionId: string | null;
  notify: (message: ToastMessage) => void;
  onError: (error: unknown) => void;
}) {
  const [bundle, setBundle] = useState<ArticleKnowledgeBundleDto | null>(null);
  const [factsJson, setFactsJson] = useState("[]");
  const [sourcesJson, setSourcesJson] = useState("[]");
  const [routesJson, setRoutesJson] = useState("[]");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const loaded = await api.getKnowledge(articleId);
    setBundle(loaded);
    setFactsJson(pretty(loaded.facts));
    setSourcesJson(pretty(loaded.sources));
    setRoutesJson(pretty(loaded.routes));
  }, [articleId]);

  useEffect(() => {
    // Loading is an intentional synchronization with the external admin API.
    // oxlint-disable-next-line react/set-state-in-effect
    load().catch(onError);
  }, [load, onError]);

  if (!bundle)
    return (
      <div className="panel">
        <p className="muted">構造化データを読み込み中…</p>
      </div>
    );
  const article =
    bundle.article ??
    (revisionId
      ? {
          articleId,
          revisionId,
          schemaVersion: 1 as const,
          quickAnswer: null,
          decisionTable: null,
          experienceGroups: [],
          currentFactIds: [],
          cautionFactIds: [],
          routeIds: [],
          relatedArticles: [],
        }
      : null);
  const quickAnswer = article?.quickAnswer ?? { summary: "", recommendation: null };
  const updateQuickAnswer = (field: "summary" | "recommendation", value: string) => {
    if (!article) return;
    setBundle({
      ...bundle,
      article: {
        ...article,
        quickAnswer: {
          ...quickAnswer,
          [field]: value === "" && field === "recommendation" ? null : value,
        },
      },
    });
  };

  const save = async () => {
    if (!article) throw new Error("先に下書きを保存してください");
    setBusy(true);
    try {
      const facts = JSON.parse(factsJson) as ArticleKnowledgeBundleDto["facts"];
      const sources = JSON.parse(sourcesJson) as ArticleKnowledgeBundleDto["sources"];
      const routes = JSON.parse(routesJson) as ArticleKnowledgeBundleDto["routes"];
      const saved = await api.saveKnowledge(articleId, {
        article: bundle.article ?? article,
        facts,
        sources,
        routes,
      });
      setBundle(saved);
      setFactsJson(pretty(saved.facts));
      setSourcesJson(pretty(saved.sources));
      setRoutesJson(pretty(saved.routes));
      notify({ tone: "info", text: "構造化データを保存しました" });
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Travel Knowledge</h2>
      <p className="muted">
        公開本文とは別の、検索・WebMCP・MCP共通データです。一次体験の候補は保存後に人が確定します。
      </p>
      {!revisionId && <p className="problems">下書きを保存すると編集できます。</p>}
      <label>
        <span>Quick Answer</span>
        <textarea
          rows={3}
          value={quickAnswer.summary}
          onChange={(event) => updateQuickAnswer("summary", event.target.value)}
        />
      </label>
      <label>
        <span>おすすめ・判断補足（任意）</span>
        <textarea
          rows={2}
          value={quickAnswer.recommendation ?? ""}
          onChange={(event) => updateQuickAnswer("recommendation", event.target.value)}
        />
      </label>
      <details>
        <summary>事実・出典・経路を編集</summary>
        <label>
          <span>Facts (JSON)</span>
          <textarea
            rows={14}
            value={factsJson}
            onChange={(event) => setFactsJson(event.target.value)}
          />
        </label>
        <label>
          <span>Sources (JSON)</span>
          <textarea
            rows={8}
            value={sourcesJson}
            onChange={(event) => setSourcesJson(event.target.value)}
          />
        </label>
        <label>
          <span>Routes (JSON)</span>
          <textarea
            rows={10}
            value={routesJson}
            onChange={(event) => setRoutesJson(event.target.value)}
          />
        </label>
      </details>
      <div className="row">
        <button
          className="primary"
          disabled={busy || !revisionId || quickAnswer.summary.trim() === ""}
          onClick={() => void save()}
        >
          構造化データを保存
        </button>
        <span className="muted">
          AI候補生成: {bundle.canSuggestWithAi ? "利用可能" : "未設定（手動編集は可能）"}
        </span>
        <button
          disabled={busy || !bundle.canSuggestWithAi}
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                const suggested = await api.suggestKnowledgeFacts(articleId);
                await load();
                notify({
                  tone: "info",
                  text: `${suggested.facts.length}件の確認候補を作成しました`,
                });
              } catch (error) {
                onError(error);
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          AIで確認候補を抽出
        </button>
      </div>
      {bundle.facts
        .filter((fact) => fact.provenance === "firsthand" && fact.status === "candidate")
        .map((fact) => (
          <div className="row" key={fact.id}>
            <span>
              <strong>確認待ち:</strong> {fact.statement}
            </span>
            <button
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    await api.verifyKnowledgeFact(fact.id);
                    await load();
                    notify({ tone: "info", text: "一次体験として確定しました" });
                  } catch (error) {
                    onError(error);
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              本人確認して確定
            </button>
          </div>
        ))}
    </div>
  );
}
