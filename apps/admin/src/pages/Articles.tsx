import { type FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { formatDateTime, formatRelative } from "../lib/labels";
import { inPhase as is } from "../lib/article-state";
import { PhaseBadge } from "../ui/PhaseBadge";
import { href } from "../lib/route";
import { useRemembered, useResource, useTitle } from "../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";
import { useToast } from "../ui/toast";
import {
  canSelectForPublication,
  publishSelection,
  type BulkPublishResult,
} from "../lib/bulk-publish";
import { SitePublication } from "../ui/SitePublication";

const FILTERS = [
  { key: "all", label: "すべて", test: () => true },
  { key: "live", label: "公開中", test: is("live", "changed") },
  { key: "changes", label: "変更未公開", test: is("changed") },
  { key: "draft", label: "下書き・非公開", test: is("draft", "withdrawn") },
  { key: "scheduled", label: "予約", test: is("scheduled") },
  { key: "archived", label: "アーカイブ", test: is("archived") },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];
const FILTER_KEYS = FILTERS.map((entry) => entry.key);
const KINDS = ["article", "page", "all"] as const;

export function Articles() {
  useTitle("記事");
  const articles = useResource(() => api.listArticles().then((r) => r.items), "articles");
  // Kept while an article is open, so coming back lands on the same list.
  const [filter, setFilter] = useRemembered<FilterKey>("articles.filter", "all", FILTER_KEYS);
  const [kind, setKind] = useRemembered<(typeof KINDS)[number]>("articles.kind", "article", KINDS);
  const [query, setQuery] = useRemembered<string>("articles.query", "");
  // Filtering re-renders every row; typing stays responsive while it catches up.
  const deferredQuery = useDeferredValue(query);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<BulkPublishResult | null>(null);
  const publication = useResource(() => api.publicationStatus(), "publication");
  const reloadPublication = publication.reload;
  const pending = publication.data?.state === "queued" || publication.data?.state === "building";
  // Site status only takes room when it needs attention; the editor shows it always.
  const showPublication =
    pending ||
    publication.error !== undefined ||
    publication.data?.state === "failed" ||
    publication.data?.state === "unconfigured" ||
    result !== null;
  const toast = useToast();
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void reloadPublication(), 10000);
    return () => clearInterval(timer);
  }, [pending, reloadPublication]);

  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const test = FILTERS.find((entry) => entry.key === filter)?.test ?? (() => true);
    return (articles.data ?? [])
      .filter((item) => kind === "all" || item.kind === kind)
      .filter(test)
      .filter(
        (item) =>
          needle === "" ||
          item.title.toLowerCase().includes(needle) ||
          item.slug.includes(needle) ||
          (item.path ?? "").includes(needle),
      )
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [articles.data, filter, kind, deferredQuery]);

  const selectable = visible.filter(canSelectForPublication);
  const chosen = selectable.filter((article) => selected.has(article.id));
  const allSelected = selectable.length > 0 && chosen.length === selectable.length;

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function publishChosen(): Promise<void> {
    if (publishingRef.current || chosen.length === 0) return;
    publishingRef.current = true;
    setPublishing(true);
    setProgress(0);
    setTotal(chosen.length);
    setResult(null);
    try {
      const outcome = await publishSelection(chosen, setProgress);
      setResult(outcome);
      setSelected(
        new Set(outcome.items.filter((item) => !item.published).map((item) => item.article.id)),
      );
      if (outcome.publication) publication.setData(() => outcome.publication ?? undefined);
      await articles.reload();
      await publication.reload();
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  async function retryBuild(): Promise<void> {
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setTotal(0);
    try {
      publication.setData(() => undefined);
      await api.retryPublication();
      setResult((current) => (current ? { ...current, buildError: null } : null));
      await publication.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  const countFor = (key: FilterKey): number => {
    const test = FILTERS.find((entry) => entry.key === key)?.test ?? (() => true);
    return (articles.data ?? []).filter((item) => kind === "all" || item.kind === kind).filter(test)
      .length;
  };

  return (
    <>
      <PageHeader
        title="記事"
        meta={articles.data && `${visible.length}件`}
        actions={
          <button
            type="button"
            className="primary"
            disabled={publishing}
            onClick={() => setCreating((open) => !open)}
          >
            {creating ? "閉じる" : "新規作成"}
          </button>
        }
      />

      {creating && <CreateArticle />}

      <div className="toolbar">
        <fieldset className="chips">
          <legend className="sr-only">状態で絞り込む</legend>
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="chip"
              aria-pressed={filter === entry.key}
              disabled={publishing}
              onClick={() => {
                setFilter(entry.key);
                setSelected(new Set());
              }}
            >
              {entry.label}
              {articles.data && <span className="chip__count">{countFor(entry.key)}</span>}
            </button>
          ))}
        </fieldset>
        <select
          aria-label="種別"
          value={kind}
          disabled={publishing}
          onChange={(event) => {
            setKind(event.target.value as typeof kind);
            setSelected(new Set());
          }}
        >
          <option value="article">記事</option>
          <option value="page">固定ページ</option>
          <option value="all">すべての種別</option>
        </select>
        <input
          type="search"
          aria-label="検索"
          placeholder="タイトル / slug / URL"
          value={query}
          disabled={publishing}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(new Set());
          }}
        />
      </div>

      {showPublication && (
        <Panel title="公開の状況">
          {result && (
            <div aria-live="polite">
              <p>
                {result.items.filter((item) => item.published).length}件の公開を受け付けました。
                {result.items.some((item) => !item.published) &&
                  " 公開できなかった記事は、修正して再度選択してください。"}
              </p>
              {result.items.some((item) => !item.published) && (
                <ul className="problems">
                  {result.items
                    .filter((item) => !item.published)
                    .map((item) => (
                      <li key={item.article.id}>
                        <a href={href.article(item.article.id)}>
                          {item.article.title || item.article.slug}
                        </a>
                        ：{item.error}
                      </li>
                    ))}
                </ul>
              )}
              {result.buildError && (
                <div className="form-error">
                  <p>サイトへの反映を開始できませんでした：{result.buildError}</p>
                  <button type="button" disabled={publishing} onClick={() => void retryBuild()}>
                    サイトへの反映を再試行
                  </button>
                </div>
              )}
            </div>
          )}
          <SitePublication
            publication={publication}
            disabled={publishing}
            onRetry={() => void retryBuild()}
          />
        </Panel>
      )}

      <Panel className="panel--flush">
        {articles.error ? (
          <ErrorState error={articles.error} onRetry={() => void articles.reload()} />
        ) : articles.loading ? (
          <SkeletonRows rows={10} />
        ) : visible.length === 0 ? (
          <EmptyState>
            該当する記事はありません。
            {(filter !== "all" || query !== "") && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                絞り込みを解除
              </button>
            )}
          </EmptyState>
        ) : (
          <table className="table table--articles">
            <thead>
              <tr>
                <th className="table__select">
                  <span className="sr-only">公開する記事を選択</span>
                </th>
                <th>タイトル</th>
                <th>状態</th>
                <th className="hide-narrow">URL</th>
                <th>更新</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td className="table__select">
                    {/* Only what can be published gets a box, so the column reads at a glance. */}
                    {canSelectForPublication(item) && (
                      <input
                        type="checkbox"
                        aria-label={`${item.title || item.slug}を公開対象に選択`}
                        checked={selected.has(item.id)}
                        disabled={publishing}
                        onChange={() => toggle(item.id)}
                      />
                    )}
                  </td>
                  <td className="table__main">
                    <a className="table__title" href={href.article(item.id)}>
                      {item.title || item.slug}
                    </a>
                    {item.kind === "page" && <Badge>固定</Badge>}
                    {item.noindex && <Badge>noindex</Badge>}
                  </td>
                  <td className="nowrap table__status">
                    <PhaseBadge article={item} />
                  </td>
                  <td className="hide-narrow">
                    {item.path && item.isLive ? (
                      <a
                        className="muted mono"
                        href={`https://tomokichidiary.com${item.path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.path}
                      </a>
                    ) : (
                      <span className="muted mono">{item.path ?? "—"}</span>
                    )}
                  </td>
                  <td className="muted nowrap table__date" title={formatDateTime(item.updatedAt)}>
                    {formatRelative(item.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {(selectable.length > 0 || publishing) && (
        <div className="bulk-bar" aria-live="polite">
          <label className="bulk-bar__all">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(node) => {
                if (node) node.indeterminate = chosen.length > 0 && !allSelected;
              }}
              disabled={publishing}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(selectable.map((item) => item.id)))
              }
            />
            公開できる{selectable.length}件
            {chosen.length > 0 && <strong>（{chosen.length}件を選択）</strong>}
          </label>
          <button
            type="button"
            className="primary"
            disabled={publishing || chosen.length === 0}
            onClick={() => void publishChosen()}
          >
            {publishing
              ? total > 0
                ? `公開処理中… ${progress}/${total}`
                : "サイトへの反映を再試行中…"
              : "まとめて公開"}
          </button>
        </div>
      )}
    </>
  );
}

function CreateArticle() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<"article" | "page">("article");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const title = String(form.get("title")).trim();
    const path = String(form.get("path")).trim();
    // The editor opens in its own tab so this list stays where it was. The tab
    // is opened now, while the click still counts as the user's: browsers
    // (Safari above all) block a window opened after the request returns.
    const tab = globalThis.open("about:blank", "_blank");
    setBusy(true);
    try {
      const created = await api.createArticle({
        slug,
        locale: "ja",
        kind,
        // The URL is chosen explicitly, never derived silently from the slug.
        path: path || (kind === "page" ? `/${slug}` : `/posts/${slug}`),
        draft: {
          title,
          summary: "（下書き）",
          bodyMarkdown: "本文をここに書きます。",
          seoTitleOverride: null,
          seoDescriptionOverride: null,
          changeSummary: "作成",
        },
      });
      const editor = href.article(created.id);
      if (tab && !tab.closed) {
        tab.location.href = `${globalThis.location.pathname}${globalThis.location.search}${editor}`;
        element.reset();
        setSlug("");
        toast.info(`「${title}」を作成し、別のタブで開きました`);
      } else globalThis.location.hash = editor;
    } catch (error) {
      tab?.close();
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="新しい記事">
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label className="field field--wide">
          <span>タイトル</span>
          <input name="title" required maxLength={120} />
        </label>
        <label className="field">
          <span>slug（管理用・英小文字とハイフン）</span>
          <input
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
          />
        </label>
        <label className="field">
          <span>種別</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="article">記事</option>
            <option value="page">固定ページ</option>
          </select>
        </label>
        <label className="field field--wide">
          <span>URL</span>
          <input
            name="path"
            placeholder={slug ? (kind === "page" ? `/${slug}` : `/posts/${slug}`) : "/posts/…"}
            pattern="/.*"
          />
        </label>
        <div className="form-actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "作成中…" : "作成して別タブで編集"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
