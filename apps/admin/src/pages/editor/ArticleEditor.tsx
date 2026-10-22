import { MonetizationSection } from "./MonetizationSection";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { enhanceAppleMusic } from "@tomokichi/contracts";
import { insertAppleMusic } from "../../lib/apple-music";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { insertMarkdownImage } from "../../lib/markdown-image";
import { useEditorSections } from "./section-save";
import { api } from "../../lib/api";
import { bodyStats, draftFrom, isDirty, normalizeDraft, type DraftInput } from "../../lib/draft";
import { articleStatusLabels, formatRelative } from "../../lib/labels";
import { href } from "../../lib/route";
import { useResource, useTitle, useUnsavedWarning } from "../../ui/hooks";
import { Badge, ErrorState, PageHeader, Panel, SkeletonBlock } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { PublishSection } from "./PublishSection";
import { MediaSection } from "./MediaSection";
import { RelationsSection } from "./RelationsSection";
import { ExperienceSection } from "./ExperienceSection";
import { KnowledgeSection } from "./KnowledgeSection";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Jump targets for the editor bar. The page is long (most of all on a phone,
 * where Publish sits below everything), so every part is one tap away.
 * `side` parts already stay in view beside the form on a wide screen.
 */
const PARTS = [
  { key: "body", label: "本文" },
  { key: "seo", label: "SEO" },
  { key: "media", label: "画像" },
  { key: "relations", label: "関連付け" },
  { key: "experiences", label: "体験タグ", articleOnly: true },
  { key: "monetization", label: "収益化", articleOnly: true },
  { key: "knowledge", label: "Knowledge" },
  { key: "publish", label: "公開", side: true },
  { key: "preview", label: "プレビュー", side: true },
] as const;

const seoFrom = (draft: DraftInput) => ({
  seoTitleOverride: draft.seoTitleOverride,
  seoDescriptionOverride: draft.seoDescriptionOverride,
});

function jumpTo(key: string): void {
  document.querySelector(`[data-part="${key}"]`)?.scrollIntoView({ block: "start" });
}

export function ArticleEditor({ id }: { id: string }) {
  const article = useResource(() => api.getArticle(id), `article:${id}`);

  if (article.error && !article.data) {
    return (
      <>
        <PageHeader title="記事" meta={<a href={href.articles()}>← 記事一覧</a>} />
        <ErrorState error={article.error} onRetry={() => void article.reload()} />
      </>
    );
  }
  if (!article.data) {
    return (
      <>
        <PageHeader title={<span className="skeleton skeleton--title" />} />
        <div className="editor">
          <SkeletonBlock height="28rem" />
          <SkeletonBlock height="20rem" />
        </div>
      </>
    );
  }
  // Mounted once the article is here, so the draft starts from real data
  // rather than being copied into state by an effect.
  return <Editor article={article.data} reload={article.reload} />;
}

function Editor({ article, reload }: { article: ArticleDetailDto; reload: () => Promise<void> }) {
  const toast = useToast();
  const [draft, setDraft] = useState<DraftInput>(() => draftFrom(article));
  const [saved, setSaved] = useState<DraftInput>(() => draftFrom(article));
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [showPreview, setShowPreview] = useState(true);
  const sections = useEditorSections();
  const bodyDirty = isDirty(draft, saved);
  const dirty = bodyDirty || sections.dirty;
  const seoDirty = isDirty({ ...saved, ...seoFrom(draft) }, saved);
  const textDirty = isDirty({ ...draft, ...seoFrom(saved) }, saved);
  const unsaved = new Set([
    ...(textDirty ? ["body"] : []),
    ...(seoDirty ? ["seo"] : []),
    ...sections.dirtyKeys.split(","),
  ]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: draft.bodyMarkdown.length, end: draft.bodyMarkdown.length });
  const [publishing, setPublishing] = useState(false);
  const working = saving || publishing || sections.busy;
  useUnsavedWarning(dirty);
  useTitle(draft.title || article.slug);

  const check = useResource(() => api.publishCheck(article.id), `check:${article.id}`);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    if (saveInFlight.current || sections.busy) return false;
    saveInFlight.current = true;
    const payload = normalizeDraft(draft);
    setSaving(true);
    try {
      sections.validate();
      await api.saveDraft(article.id, payload);
      if (!(await sections.save())) return false;
      setSaved({ ...payload, changeSummary: null });
      setDraft({ ...payload, changeSummary: null });
      toast.info("下書きを保存しました");
      await Promise.all([reload(), check.reload()]);
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }, [article.id, check, dirty, draft, reload, sections, toast]);

  // ⌘S / Ctrl+S saves, as every editor does.
  const saveRef = useRef(save);
  const workingRef = useRef(working);
  useLayoutEffect(() => {
    saveRef.current = save;
    workingRef.current = working;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!workingRef.current) void saveRef.current();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, []);

  const update = <K extends keyof DraftInput>(key: K, value: DraftInput[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  // The preview renders the draft, which the public site is not serving until
  // it is published.
  const previewHtml = useMemo(
    () =>
      showPreview
        ? enhanceAppleMusic(
            marked.parse(
              draft.bodyMarkdown.replace(
                /\{\{monetization:([a-z0-9-]+)\}\}/g,
                "\n\n**［収益化スロット: $1 / 管理画面のみ］**\n\n",
              ),
              { async: false },
            ) as string,
          )
        : "",
    [draft.bodyMarkdown, showPreview],
  );
  const stats = bodyStats(draft.bodyMarkdown);

  const afterChange = async (): Promise<void> => {
    await Promise.all([reload(), check.reload()]);
  };

  return (
    <>
      <PageHeader
        title={draft.title || article.slug}
        meta={
          <>
            <a href={href.articles()}>← 記事一覧</a>
            <Badge
              tone={article.isLive ? "ok" : article.status === "scheduled" ? "accent" : "neutral"}
            >
              {articleStatusLabels[article.status] ?? article.status}
            </Badge>
            {article.hasUnpublishedChanges && <Badge tone="warn">未公開の変更あり</Badge>}
            {article.kind === "page" && <Badge>固定ページ</Badge>}
            <span className="mono">{article.path ?? "URL 未設定"}</span>
            {article.currentRevision && (
              <span>
                第{article.currentRevision.revisionNumber}版・
                {formatRelative(article.currentRevision.createdAt)}
              </span>
            )}
          </>
        }
      />

      <div className="editor-bar">
        <nav className="editor-bar__parts" aria-label="編集画面内の移動">
          {PARTS.filter((part) => !("articleOnly" in part) || article.kind === "article").map(
            (part) => (
              <button
                key={part.key}
                type="button"
                className={`chip${"side" in part ? " editor-bar__side" : ""}`}
                onClick={() => jumpTo(part.key)}
              >
                {part.label}
                {unsaved.has(part.key) && (
                  <span className="editor-bar__dot" title="未保存の変更">
                    <span className="sr-only">（未保存）</span>
                  </span>
                )}
              </button>
            ),
          )}
        </nav>
        <span className={`save-state${dirty ? " save-state--dirty" : ""}`} aria-live="polite">
          {saving ? "保存中…" : dirty ? "未保存" : "保存済み"}
        </span>
        <button
          type="button"
          className="primary"
          disabled={working || !dirty}
          onClick={() => void save()}
          title="⌘S / Ctrl+S"
        >
          すべて保存
        </button>
      </div>

      <div className="editor">
        <fieldset className="editor__main editor__fields" disabled={working}>
          <Panel title="本文" part="body">
            <label className="field">
              <span>タイトル</span>
              <input
                value={draft.title}
                maxLength={120}
                required
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <label className="field">
              <span>要約（description の既定値）</span>
              <textarea
                rows={2}
                maxLength={400}
                value={draft.summary}
                onChange={(event) => update("summary", event.target.value)}
              />
            </label>
            <label className="field">
              <span>
                本文（Markdown）
                <em className="field__hint">
                  {stats.characters.toLocaleString()}字・約{stats.minutes}分
                </em>
              </span>
              <textarea
                ref={bodyRef}
                onBlur={(event) => {
                  selection.current = {
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd,
                  };
                }}
                onSelect={(event) => {
                  selection.current = {
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd,
                  };
                }}
                className="editor__body"
                rows={28}
                value={draft.bodyMarkdown}
                onChange={(event) => update("bodyMarkdown", event.target.value)}
              />
            </label>
            <div className="row">
              <button
                type="button"
                className="link"
                onClick={() => {
                  const pasted = globalThis.prompt(
                    "Apple Music の共有URL、または「埋め込みコード」を貼り付けてください（曲・アルバム・プレイリスト）",
                  );
                  if (!pasted) return;
                  const inserted = insertAppleMusic(
                    draft.bodyMarkdown,
                    selection.current.start,
                    selection.current.end,
                    pasted,
                  );
                  if (!inserted) {
                    toast.error(
                      new Error(
                        "Apple Music の曲・アルバム・プレイリストのURLとして読み取れませんでした",
                      ),
                    );
                    return;
                  }
                  update("bodyMarkdown", inserted.body);
                  selection.current = { start: inserted.cursor, end: inserted.cursor };
                }}
              >
                ♪ Apple Musicを挿入
              </button>
            </div>
            <label className="field">
              <span>変更の要約（履歴に残ります・任意）</span>
              <input
                maxLength={400}
                value={draft.changeSummary ?? ""}
                onChange={(event) => update("changeSummary", event.target.value)}
              />
            </label>
          </Panel>

          <Panel title="SEO（空欄なら自動生成）" part="seo">
            <label className="field">
              <span>
                title
                <em className="field__hint">{(draft.seoTitleOverride ?? "").length} / 120</em>
              </span>
              <input
                maxLength={120}
                value={draft.seoTitleOverride ?? ""}
                placeholder={draft.title}
                onChange={(event) => update("seoTitleOverride", event.target.value)}
              />
            </label>
            <label className="field">
              <span>
                description
                <em className="field__hint">{(draft.seoDescriptionOverride ?? "").length} / 400</em>
              </span>
              <textarea
                rows={2}
                maxLength={400}
                value={draft.seoDescriptionOverride ?? ""}
                placeholder={draft.summary}
                onChange={(event) => update("seoDescriptionOverride", event.target.value)}
              />
            </label>
          </Panel>

          <div data-part="media">
            <MediaSection
              article={article}
              onSaved={afterChange}
              register={sections.register}
              onSaveAll={save}
              onInsert={(url, alt) => {
                const inserted = insertMarkdownImage(
                  draft.bodyMarkdown,
                  selection.current.start,
                  selection.current.end,
                  url,
                  alt,
                );
                update("bodyMarkdown", inserted.body);
                selection.current = { start: inserted.cursor, end: inserted.cursor };
                requestAnimationFrame(() => {
                  bodyRef.current?.focus();
                  bodyRef.current?.setSelectionRange(inserted.cursor, inserted.cursor);
                });
              }}
            />
          </div>
          <div data-part="relations">
            <RelationsSection
              article={article}
              onSaved={afterChange}
              register={sections.register}
              onSaveAll={save}
            />
          </div>
          {article.kind === "article" && (
            <div data-part="experiences">
              <ExperienceSection
                article={article}
                onSaved={afterChange}
                register={sections.register}
                onSaveAll={save}
              />
            </div>
          )}
          {article.kind === "article" && (
            <div data-part="monetization">
              <MonetizationSection
                articleId={article.id}
                needsPublication={article.hasUnpublishedChanges || article.status !== "published"}
                body={draft.bodyMarkdown}
                onBody={(body) => update("bodyMarkdown", body)}
                register={sections.register}
                onSaveAll={save}
              />
            </div>
          )}
          <div data-part="knowledge">
            <KnowledgeSection
              articleId={article.id}
              register={sections.register}
              onSaveAll={save}
              revisionId={article.currentRevision?.id ?? null}
            />
          </div>
        </fieldset>

        <aside className="editor__side">
          <div data-part="publish">
            <PublishSection
              article={article}
              check={check}
              dirty={dirty}
              save={save}
              onChanged={afterChange}
              working={working}
              onBusy={setPublishing}
            />
          </div>
          <Panel
            part="preview"
            title="プレビュー（下書き）"
            actions={
              <button type="button" className="link" onClick={() => setShowPreview((on) => !on)}>
                {showPreview ? "隠す" : "表示"}
              </button>
            }
            className="preview-panel"
          >
            {showPreview && (
              <article className="preview">
                <h1>{draft.title}</h1>
                <p className="preview__lead">{draft.summary}</p>
                {/* Authored by the site owner in this same admin. */}
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </article>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
