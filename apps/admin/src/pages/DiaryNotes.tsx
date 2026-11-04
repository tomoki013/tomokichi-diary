import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { href } from "../lib/route";
import { formatDateTime } from "../lib/labels";
import { useResource, useTitle } from "../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";
import { useToast } from "../ui/toast";

const defaultSlug = () => `note-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;

export function DiaryNotes() {
  const notes = useResource(
    () => api.listDiaryNotes().then((result) => result.items),
    "diary-notes",
  );
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useTitle("一言日記");

  const ordered = useMemo(
    () =>
      [...(notes.data ?? [])].toSorted((a, b) =>
        (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt),
      ),
    [notes.data],
  );

  async function create(): Promise<void> {
    const cleanTitle = title.trim();
    const cleanSlug = slug.trim() || defaultSlug();
    if (!cleanTitle) return;
    setBusy(true);
    try {
      const result = await api.createDiaryNote({ slug: cleanSlug, title: cleanTitle });
      globalThis.location.hash = href.diaryNote(result.id);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="ともきちの一言日記" meta="短い旅の記憶や気づきを書き残します" />
      <Panel title="新しい下書き">
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="field">
            <span>タイトル</span>
            <input
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例：テレビで見かけたサントリーニ島"
            />
          </label>
          <label className="field">
            <span>URL slug</span>
            <input
              maxLength={96}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder={defaultSlug()}
            />
          </label>
          <p className="muted small">
            本文は作成後に書けます。slug を空欄にすると日時から仮の URL を付けます。
          </p>
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            {busy ? "作成中…" : "下書きを作る"}
          </button>
        </form>
      </Panel>

      <Panel title={notes.data ? `一言日記（${notes.data.length}件）` : "一言日記"}>
        {notes.error ? (
          <ErrorState error={notes.error} onRetry={() => void notes.reload()} />
        ) : notes.loading ? (
          <SkeletonRows rows={5} />
        ) : ordered.length === 0 ? (
          <EmptyState>一言日記はまだありません。</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table--articles">
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>状態</th>
                  <th>投稿日</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((note) => (
                  <tr key={note.id}>
                    <td>
                      <a className="table__title" href={href.diaryNote(note.id)}>
                        {note.title || note.slug}
                      </a>
                      <div className="muted mono">{note.path ?? `/notes/${note.slug}`}</div>
                    </td>
                    <td>
                      <Badge>
                        {note.isLive ? "公開中" : note.status === "archived" ? "取下げ" : "下書き"}
                      </Badge>
                      {note.hasUnpublishedChanges && (
                        <span className="muted small"> 未公開の変更</span>
                      )}
                    </td>
                    <td>{note.publishedAt?.slice(0, 10) ?? "—"}</td>
                    <td>{formatDateTime(note.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
