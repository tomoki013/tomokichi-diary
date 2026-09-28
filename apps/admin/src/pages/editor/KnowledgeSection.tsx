import { useState } from "react";
import type { ArticleKnowledgeBundleDto, ArticleKnowledgeDto } from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { useResource } from "../../ui/hooks";
import { Badge, ErrorState, SkeletonRows } from "../../ui/parts";
import { useToast } from "../../ui/toast";

const provenanceLabels: Record<string, string> = {
  firsthand: "一次体験",
  official: "公式",
  researched: "調査",
  derived: "推定",
};

/**
 * Structured travel knowledge, served to search, WebMCP and MCP alongside the
 * body. Collapsed and loaded only when opened: most edits never touch it.
 */
export function KnowledgeSection({
  articleId,
  revisionId,
}: {
  articleId: string;
  revisionId: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="panel panel--details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <h2>Travel Knowledge</h2>
        <span className="muted small">検索・WebMCP・MCP 用の構造化データ</span>
      </summary>
      {open && <KnowledgeEditor articleId={articleId} revisionId={revisionId} />}
    </details>
  );
}

function emptyKnowledge(articleId: string, revisionId: string): ArticleKnowledgeDto {
  return {
    articleId,
    revisionId,
    schemaVersion: 1,
    quickAnswer: null,
    decisionTable: null,
    experienceGroups: [],
    currentFactIds: [],
    cautionFactIds: [],
    routeIds: [],
    relatedArticles: [],
  };
}

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

function KnowledgeEditor({
  articleId,
  revisionId,
}: {
  articleId: string;
  revisionId: string | null;
}) {
  const loaded = useResource(() => api.getKnowledge(articleId), `knowledge:${articleId}`);
  if (loaded.error) return <ErrorState error={loaded.error} onRetry={() => void loaded.reload()} />;
  if (!loaded.data) return <SkeletonRows rows={4} />;
  if (!revisionId) return <p className="muted">下書きを保存すると編集できます。</p>;
  return <KnowledgeForm articleId={articleId} revisionId={revisionId} initial={loaded.data} />;
}

function KnowledgeForm({
  articleId,
  revisionId,
  initial,
}: {
  articleId: string;
  revisionId: string;
  initial: ArticleKnowledgeBundleDto;
}) {
  const toast = useToast();
  const [bundle, setBundle] = useState(initial);
  const [json, setJson] = useState(() => ({
    facts: pretty(initial.facts),
    sources: pretty(initial.sources),
    routes: pretty(initial.routes),
  }));
  const [busy, setBusy] = useState(false);

  const adopt = (next: ArticleKnowledgeBundleDto): void => {
    setBundle(next);
    setJson({
      facts: pretty(next.facts),
      sources: pretty(next.sources),
      routes: pretty(next.routes),
    });
  };

  const knowledge = bundle.article ?? emptyKnowledge(articleId, revisionId);
  const quickAnswer = knowledge.quickAnswer ?? { summary: "", recommendation: null };
  const parsed = (() => {
    try {
      return {
        facts: JSON.parse(json.facts) as ArticleKnowledgeBundleDto["facts"],
        sources: JSON.parse(json.sources) as ArticleKnowledgeBundleDto["sources"],
        routes: JSON.parse(json.routes) as ArticleKnowledgeBundleDto["routes"],
      };
    } catch {
      return null;
    }
  })();

  const setQuickAnswer = (field: "summary" | "recommendation", value: string): void =>
    setBundle({
      ...bundle,
      article: {
        ...knowledge,
        quickAnswer: {
          ...quickAnswer,
          [field]: field === "recommendation" && value === "" ? null : value,
        },
      },
    });

  const act = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  const candidates = bundle.facts.filter(
    (fact) => fact.provenance === "firsthand" && fact.status === "candidate",
  );

  return (
    <div className="knowledge">
      <label className="field">
        <span>Quick Answer（必須）</span>
        <textarea
          rows={3}
          value={quickAnswer.summary}
          onChange={(event) => setQuickAnswer("summary", event.target.value)}
        />
      </label>
      <label className="field">
        <span>おすすめ・判断の補足（任意）</span>
        <textarea
          rows={2}
          value={quickAnswer.recommendation ?? ""}
          onChange={(event) => setQuickAnswer("recommendation", event.target.value)}
        />
      </label>

      {candidates.length > 0 && (
        <div className="field">
          <span className="field__label">確認待ちの一次体験（本人確認で確定）</span>
          <ul className="rows">
            {candidates.map((fact) => (
              <li key={fact.id}>
                <span className="rows__main">{fact.statement}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.verifyKnowledgeFact(fact.id);
                      adopt(await api.getKnowledge(articleId));
                      toast.info("一次体験として確定しました");
                    })
                  }
                >
                  確定
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bundle.facts.length > 0 && (
        <table className="table table--compact">
          <thead>
            <tr>
              <th>事実（{bundle.facts.length}）</th>
              <th>出所</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {bundle.facts.map((fact) => (
              <tr key={fact.id}>
                <td>{fact.statement}</td>
                <td className="nowrap">{provenanceLabels[fact.provenance] ?? fact.provenance}</td>
                <td>
                  <Badge tone={fact.status === "verified" ? "ok" : "warn"}>
                    {fact.status === "verified" ? "確定" : "候補"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="subdetails">
        <summary>事実・出典・経路を JSON で編集</summary>
        {(["facts", "sources", "routes"] as const).map((key) => (
          <label key={key} className="field">
            <span>{key}</span>
            <textarea
              className="mono"
              rows={key === "facts" ? 14 : 8}
              value={json[key]}
              onChange={(event) =>
                setJson((current) => ({ ...current, [key]: event.target.value }))
              }
            />
          </label>
        ))}
        {!parsed && <p className="form-error">JSON として読めません</p>}
      </details>

      <div className="panel__foot">
        <span className="muted small">
          AI 候補抽出: {bundle.canSuggestWithAi ? "利用可能" : "未設定"}
        </span>
        <button
          type="button"
          disabled={busy || !bundle.canSuggestWithAi}
          onClick={() =>
            void act(async () => {
              const suggested = await api.suggestKnowledgeFacts(articleId);
              adopt(await api.getKnowledge(articleId));
              toast.info(`${suggested.facts.length}件の確認候補を作りました`);
            })
          }
        >
          AI で候補を抽出
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !parsed || quickAnswer.summary.trim() === ""}
          onClick={() =>
            void act(async () => {
              if (!parsed) return;
              adopt(
                await api.saveKnowledge(articleId, {
                  article: { ...knowledge, quickAnswer },
                  ...parsed,
                }),
              );
              toast.info("構造化データを保存しました");
            })
          }
        >
          構造化データを保存
        </button>
      </div>
    </div>
  );
}
