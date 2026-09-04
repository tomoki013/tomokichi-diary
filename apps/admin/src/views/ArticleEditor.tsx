import { useCallback, useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import type {
  ArticleDetailDto,
  LocationDto,
  PublishCheckDto,
  TaxonomyDto,
} from "@tomokichi/contracts";
import { api, type DraftInput, type MediaUsageInput, type RelationsInput } from "../api";
import type { ToastMessage } from "../components/Toast";
import { MediaPanel } from "../components/MediaPanel";
import { RelationsPanel } from "../components/RelationsPanel";
import { KnowledgePanel } from "../components/KnowledgePanel";

marked.setOptions({ gfm: true, breaks: false });

export function ArticleEditor({
  id,
  notify,
  onError,
}: {
  id: string;
  notify: (message: ToastMessage) => void;
  onError: (error: unknown) => void;
}) {
  const [article, setArticle] = useState<ArticleDetailDto | null>(null);
  const [draft, setDraft] = useState<DraftInput | null>(null);
  const [check, setCheck] = useState<PublishCheckDto | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyDto | null>(null);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const detail = await api.getArticle(id);
    setArticle(detail);
    setDraft({
      title: detail.currentRevision?.title ?? "",
      summary: detail.currentRevision?.summary ?? "",
      bodyMarkdown: detail.currentRevision?.bodyMarkdown ?? "",
      seoTitleOverride: detail.currentRevision?.seoTitleOverride ?? null,
      seoDescriptionOverride: detail.currentRevision?.seoDescriptionOverride ?? null,
      changeSummary: null,
    });
    setCheck(await api.publishCheck(id));
  }, [id]);

  useEffect(() => {
    // Loading from the API is exactly the "synchronising with an external
    // system" case the rule exists for; every setState here follows an await.
    // oxlint-disable-next-line react/set-state-in-effect
    load().catch(onError);
    api.taxonomy().then(setTaxonomy, onError);
    api.listLocations().then((response) => setLocations(response.items), onError);
  }, [load, onError]);

  // The preview renders the draft, which is deliberately not what the public
  // site is serving until the article is published (instruction §78).
  const previewHtml = useMemo(
    () => (draft ? (marked.parse(draft.bodyMarkdown, { async: false }) as string) : ""),
    [draft],
  );

  if (!article || !draft) return <p className="muted">読み込み中…</p>;

  const run = async (action: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await load();
      notify({ tone: "info", text: success });
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  const update = <K extends keyof DraftInput>(key: K, value: DraftInput[K]): void =>
    setDraft({ ...draft, [key]: value });

  return (
    <>
      <div className="panel">
        <div className="row">
          <a href="#/">← 一覧へ</a>
          <span className={`badge ${article.isLive ? "live" : ""}`}>{article.status}</span>
          {article.hasUnpublishedChanges && <span className="badge dirty">未公開の変更あり</span>}
          <span className="muted">{article.path ?? "URL 未設定"}</span>
          <span style={{ flex: 1 }} />
          <button
            disabled={busy}
            onClick={() =>
              void run(() => api.saveDraft(id, draft).then(() => {}), "下書きを保存しました")
            }
          >
            下書きを保存
          </button>
          <button
            className="primary"
            disabled={busy || check?.publishable === false}
            onClick={() => void run(() => api.publish(id).then(() => {}), "公開しました")}
          >
            公開
          </button>
          {article.status === "published" && (
            <button
              disabled={busy}
              onClick={() => void run(() => api.unpublish(id).then(() => {}), "非公開にしました")}
            >
              非公開に戻す
            </button>
          )}
          <button
            className="danger"
            disabled={busy}
            onClick={() => void run(() => api.archive(id).then(() => {}), "アーカイブしました")}
          >
            アーカイブ
          </button>
        </div>
        {check && !check.publishable && (
          <ul className="problems">
            {check.problems.map((problem) => (
              <li key={`${problem.code}-${problem.field ?? ""}`}>
                {problem.field ? `${problem.field}: ` : ""}
                {problem.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="editor">
        <div>
          <div className="panel">
            <h2>本文</h2>
            <label>
              <span>タイトル</span>
              <input
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <label>
              <span>要約（description の既定値）</span>
              <textarea
                rows={3}
                value={draft.summary}
                onChange={(event) => update("summary", event.target.value)}
              />
            </label>
            <label>
              <span>本文（Markdown）</span>
              <textarea
                rows={26}
                value={draft.bodyMarkdown}
                onChange={(event) => update("bodyMarkdown", event.target.value)}
              />
            </label>
            <label>
              <span>変更の要約（履歴に残ります）</span>
              <input
                value={draft.changeSummary ?? ""}
                onChange={(event) => update("changeSummary", event.target.value || null)}
              />
            </label>
          </div>

          <div className="panel">
            <h2>SEO 上書き（未入力なら自動生成）</h2>
            <label>
              <span>title</span>
              <input
                value={draft.seoTitleOverride ?? ""}
                onChange={(event) => update("seoTitleOverride", event.target.value || null)}
              />
            </label>
            <label>
              <span>description</span>
              <textarea
                rows={2}
                value={draft.seoDescriptionOverride ?? ""}
                onChange={(event) => update("seoDescriptionOverride", event.target.value || null)}
              />
            </label>
          </div>

          <MediaPanel
            article={article}
            busy={busy}
            onSave={(media: MediaUsageInput[]) =>
              void run(() => api.saveArticleMedia(id, media).then(() => {}), "画像を更新しました")
            }
            onError={onError}
          />

          <RelationsPanel
            article={article}
            taxonomy={taxonomy}
            locations={locations}
            busy={busy}
            onSave={(relations: RelationsInput) =>
              void run(
                () => api.saveRelations(id, relations).then(() => {}),
                "関連付けを更新しました",
              )
            }
          />

          <KnowledgePanel
            articleId={id}
            revisionId={article.currentRevision?.id ?? null}
            notify={notify}
            onError={onError}
          />
        </div>

        <div className="panel" style={{ position: "sticky", top: "4rem" }}>
          <h2>プレビュー（下書き）</h2>
          <div className="preview">
            <h1>{draft.title}</h1>
            <p>
              <em>{draft.summary}</em>
            </p>
            {/* Content is authored by the site owner in this same admin. */}
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      </div>
    </>
  );
}
