import { useEffect, useState, type FormEvent } from "react";
import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { api } from "../api";
import type { ToastMessage } from "../components/Toast";

export function ArticleList({
  notify,
  onError,
}: {
  notify: (message: ToastMessage) => void;
  onError: (error: unknown) => void;
}) {
  const [items, setItems] = useState<ArticleSummaryDto[] | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.listArticles().then((response) => setItems(response.items), onError);
  }, [onError]);

  const visible = (items ?? []).filter(
    (item) =>
      filter === "" ||
      item.title.toLowerCase().includes(filter.toLowerCase()) ||
      item.slug.includes(filter.toLowerCase()),
  );

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const slug = String(form.get("slug"));
    const kind = String(form.get("kind")) as "article" | "page";
    setCreating(true);
    try {
      const created = await api.createArticle({
        slug,
        locale: "ja",
        kind,
        // The URL is chosen explicitly, never derived from the slug.
        path: String(form.get("path")) || `/posts/${slug}`,
        draft: {
          title: String(form.get("title")),
          summary: "（下書き）",
          bodyMarkdown: "本文をここに書きます。",
          seoTitleOverride: null,
          seoDescriptionOverride: null,
          changeSummary: "created",
        },
      });
      globalThis.location.hash = `#/articles/${created.id}`;
    } catch (error) {
      onError(error);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="panel">
        <h2>新しい記事</h2>
        <form onSubmit={(event) => void create(event)}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label style={{ flex: "2 1 16rem" }}>
              <span>タイトル</span>
              <input name="title" required />
            </label>
            <label style={{ flex: "1 1 12rem" }}>
              <span>slug（管理用）</span>
              <input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
            </label>
            <label style={{ flex: "1 1 14rem" }}>
              <span>URL（空なら /posts/&lt;slug&gt;）</span>
              <input name="path" placeholder="/posts/…" />
            </label>
            <label style={{ flex: "0 1 9rem" }}>
              <span>種別</span>
              <select name="kind" defaultValue="article">
                <option value="article">記事</option>
                <option value="page">固定ページ</option>
              </select>
            </label>
            <button className="primary" type="submit" disabled={creating}>
              作成
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>記事一覧 {items && `(${items.length})`}</h2>
        <label>
          <span>絞り込み</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="タイトル / slug"
          />
        </label>
        {items === null ? (
          <p className="muted">読み込み中…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>タイトル</th>
                <th>URL</th>
                <th>状態</th>
                <th>更新</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={`#/articles/${item.id}`}>{item.title || item.slug}</a>
                    {item.kind === "page" && (
                      <span className="badge" style={{ marginLeft: "0.4rem" }}>
                        固定
                      </span>
                    )}
                  </td>
                  <td className="muted">{item.path ?? "—"}</td>
                  <td>
                    <span className={`badge ${item.isLive ? "live" : ""}`}>{item.status}</span>{" "}
                    {item.hasUnpublishedChanges && (
                      <span className="badge dirty">未公開の変更</span>
                    )}
                    {item.noindex && <span className="badge">noindex</span>}
                  </td>
                  <td className="muted">{item.updatedAt.slice(0, 10)}</td>
                  <td>
                    {item.path && item.isLive && (
                      <button
                        onClick={() => {
                          globalThis.open(item.path!, "_blank", "noopener");
                          notify({ tone: "info", text: "公開ページを開きました" });
                        }}
                      >
                        表示
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
