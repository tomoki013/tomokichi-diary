import { useMemo, useState, type FormEvent } from "react";
import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { api } from "../lib/api";
import { articleStatusLabels, formatDateTime, formatRelative } from "../lib/labels";
import { href } from "../lib/route";
import { useResource, useTitle } from "../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";
import { useToast } from "../ui/toast";

const FILTERS = [
  { key: "all", label: "すべて", test: () => true },
  { key: "live", label: "公開中", test: (item: ArticleSummaryDto) => item.isLive },
  {
    key: "changes",
    label: "未公開の変更",
    test: (item: ArticleSummaryDto) => item.hasUnpublishedChanges,
  },
  { key: "draft", label: "下書き", test: (item: ArticleSummaryDto) => item.status === "draft" },
  {
    key: "scheduled",
    label: "予約",
    test: (item: ArticleSummaryDto) => item.status === "scheduled",
  },
  {
    key: "archived",
    label: "アーカイブ",
    test: (item: ArticleSummaryDto) => item.status === "archived",
  },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export function Articles() {
  useTitle("記事");
  const articles = useResource(() => api.listArticles().then((r) => r.items), "articles");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [kind, setKind] = useState<"all" | "article" | "page">("article");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
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
  }, [articles.data, filter, kind, query]);

  const countFor = (key: FilterKey): number => {
    const test = FILTERS.find((entry) => entry.key === key)?.test ?? (() => true);
    return (articles.data ?? []).filter((item) => kind === "all" || item.kind === kind).filter(test)
      .length;
  };

  return (
    <>
      <PageHeader
        title="記事"
        meta={articles.data && `${articles.data.length}件`}
        actions={
          <button type="button" className="primary" onClick={() => setCreating((open) => !open)}>
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
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
              {articles.data && <span className="chip__count">{countFor(entry.key)}</span>}
            </button>
          ))}
        </fieldset>
        <select
          aria-label="種別"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
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
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <Panel className="panel--flush">
        {articles.error ? (
          <ErrorState error={articles.error} onRetry={() => void articles.reload()} />
        ) : articles.loading ? (
          <SkeletonRows rows={10} />
        ) : visible.length === 0 ? (
          <EmptyState>該当する記事はありません。</EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>タイトル</th>
                <th>状態</th>
                <th className="hide-narrow">URL</th>
                <th>更新</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    <a className="table__title" href={href.article(item.id)}>
                      {item.title || item.slug}
                    </a>
                    {item.kind === "page" && <Badge>固定</Badge>}
                    {item.noindex && <Badge>noindex</Badge>}
                  </td>
                  <td className="nowrap">
                    <Badge
                      tone={item.isLive ? "ok" : item.status === "scheduled" ? "accent" : "neutral"}
                    >
                      {articleStatusLabels[item.status] ?? item.status}
                    </Badge>
                    {item.hasUnpublishedChanges && <Badge tone="warn">変更あり</Badge>}
                    {item.status === "scheduled" && (
                      <span className="muted small"> {formatDateTime(item.scheduledAt)}</span>
                    )}
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
                  <td className="muted nowrap" title={formatDateTime(item.updatedAt)}>
                    {formatRelative(item.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
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
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title")).trim();
    const path = String(form.get("path")).trim();
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
      globalThis.location.hash = href.article(created.id);
    } catch (error) {
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
            {busy ? "作成中…" : "作成して編集"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
