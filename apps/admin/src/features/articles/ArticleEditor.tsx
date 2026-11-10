import { useCallback, useMemo, useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle, useUnsavedWarning } from "../../data/hooks";
import { href } from "../../app/router";
import { draftFrom, isDirty, normalizeDraft, type DraftInput } from "../../lib/draft";
import { formatRelative } from "../../lib/labels";
import type { AdPreview } from "../../lib/ad-preview";
import { PhaseBadge } from "../../ui/PhaseBadge";
import { Button, Loaded, Page, Panel, TextArea, TextInput } from "../../ui/parts";
import { BodyPanel } from "../editor/BodyPanel";
import { PublishPanel } from "../editor/PublishPanel";
import { MediaPanel } from "../editor/MediaPanel";
import { RelationsPanel } from "../editor/RelationsPanel";
import { AdsPanel } from "../editor/AdsPanel";
import { KnowledgePanel } from "../editor/KnowledgePanel";

const PARTS = [
  ["body", "本文"],
  ["publish", "公開"],
  ["seo", "SEO"],
  ["media", "写真"],
  ["relations", "分類"],
  ["ads", "広告"],
  ["knowledge", "旅の知識"],
] as const;

export function ArticleEditor({ id }: { id: string }) {
  const article = useOp("article.get", { articleId: id });
  return (
    <Loaded resource={article} lines={10}>
      {(data) => <Editor key={data.currentRevision?.id ?? data.id} article={data} />}
    </Loaded>
  );
}

/** One article: the text first, then everything else folded until needed. */
function Editor({ article }: { article: ArticleDetailDto }) {
  const saved = useMemo(() => draftFrom(article), [article]);
  const [draft, setDraft] = useState<DraftInput>(saved);
  const dirty = isDirty(draft, saved);
  useUnsavedWarning(dirty);
  useTitle(draft.title || article.slug);
  const { busy, run } = useAction();
  const monetization = useOp("ads.overview");
  const set = (change: Partial<DraftInput>) => setDraft((current) => ({ ...current, ...change }));

  const save = useCallback(async (): Promise<boolean> => {
    const result = await run(
      "save",
      () => op("article.saveDraft", { articleId: article.id, ...normalizeDraft(draft) }),
      { done: "保存しました", touches: ["article", "home"] },
    );
    return result !== undefined;
  }, [article.id, draft, run]);

  const adPreview: AdPreview | null = monetization.data
    ? {
        config: monetization.data.articles.find((a) => a.articleId === article.id)?.config ?? {
          mode: "ads",
          adsEnabled: true,
          maxAds: 1,
          experimentId: null,
          placements: [],
          updatedAt: null,
        },
        offers: monetization.data.offers,
        testMarker:
          monetization.data.experiments.find(
            (e) => e.articleId === article.id && e.status === "running",
          )?.markerKey ?? null,
      }
    : null;
  const page = article.kind === "page";

  return (
    <Page
      title={
        <>
          {draft.title || "（無題）"} <PhaseBadge article={article} />
        </>
      }
      back={{
        href: href.articles(page ? "pages" : undefined),
        label: page ? "固定ページ" : "記事",
      }}
    >
      <div className="editor__bar">
        <span className="muted">
          {dirty ? "未保存の変更があります" : `保存済み · ${formatRelative(article.updatedAt)}`}
        </span>
        {article.path && article.isLive && (
          <a
            className="button button--quiet"
            href={`https://tomokichidiary.com${article.path}`}
            target="_blank"
            rel="noreferrer"
          >
            サイトで見る
          </a>
        )}
        <Button kind="primary" busy={busy === "save"} disabled={!dirty} onClick={() => void save()}>
          保存
        </Button>
      </div>
      <nav className="editor__jump" aria-label="この記事の中">
        {PARTS.filter(([key]) => !(page && (key === "ads" || key === "knowledge"))).map(
          ([key, label]) => (
            <a
              key={key}
              href={`#/articles/${encodeURIComponent(article.id)}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(key)?.scrollIntoView({ block: "start" });
              }}
            >
              {label}
            </a>
          ),
        )}
      </nav>
      <div className="editor">
        <div className="panel">
          <div className="panel__body" style={{ paddingTop: 12 }}>
            <TextInput
              label="タイトル"
              value={draft.title}
              onChange={(title) => set({ title })}
              max={120}
            />
            <TextArea
              label="要約"
              value={draft.summary}
              onChange={(summary) => set({ summary })}
              max={400}
              rows={2}
            />
          </div>
        </div>
        <BodyPanel
          body={draft.bodyMarkdown}
          onChange={(bodyMarkdown) => set({ bodyMarkdown })}
          adPreview={adPreview}
        />
        <PublishPanel article={article} unsaved={dirty} onSaveFirst={save} />
        <Panel id="seo" title="SEO" hint="空欄ならタイトルと要約から作られます" collapsible>
          <TextInput
            label="検索結果のタイトル"
            value={draft.seoTitleOverride ?? ""}
            onChange={(seoTitleOverride) => set({ seoTitleOverride })}
            max={120}
          />
          <TextArea
            label="検索結果の説明"
            value={draft.seoDescriptionOverride ?? ""}
            onChange={(seoDescriptionOverride) => set({ seoDescriptionOverride })}
            max={400}
            rows={3}
          />
          <TextInput
            label="変更のメモ（履歴用・任意）"
            value={draft.changeSummary ?? ""}
            onChange={(changeSummary) => set({ changeSummary })}
            max={400}
          />
        </Panel>
        <MediaPanel article={article} />
        <RelationsPanel article={article} />
        {!page && <AdsPanel article={article} />}
        {!page && <KnowledgePanel article={article} />}
        <a className="muted" href={href.activity("article", article.id)}>
          この記事の操作ログ
        </a>
      </div>
    </Page>
  );
}
