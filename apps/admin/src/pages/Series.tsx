import { useState, type FormEvent } from "react";
import type { CollectionAdminDto, MediaAssetDto } from "@tomokichi/contracts";
import { api } from "../lib/api";
import { href } from "../lib/route";
import { usePagedSearch, useResource, useTitle, useUnsavedWarning } from "../ui/hooks";
import { EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";
import { MediaThumb } from "../ui/MediaThumb";
import { useToast } from "../ui/toast";

const SITE = "https://tomokichidiary.com";

/**
 * Series (themes read across trips). Journeys are listed by the same API but
 * stay out of this screen: they are trip records with their own dates.
 */
export function SeriesList() {
  useTitle("シリーズ");
  const series = useResource(() => api.listCollections("series").then((r) => r.items), "series");

  return (
    <>
      <PageHeader
        title="シリーズ"
        meta={series.data && `${series.data.length}件`}
        actions={
          <a className="button primary" href={href.seriesEdit("new")}>
            ＋ 新しいシリーズ
          </a>
        }
      />
      <p className="muted">
        記事の所属は各記事の「関連付け → シリーズ・旅の記録」で選びます。公開記事が0件のシリーズは
        検索エンジンに載らず（noindex）、サイトのおすすめにも出ません。変更はサイトの次回反映で公開されます。
      </p>
      {series.error ? (
        <ErrorState error={series.error} onRetry={() => void series.reload()} />
      ) : !series.data ? (
        <SkeletonRows rows={4} />
      ) : series.data.length === 0 ? (
        <EmptyState>シリーズはまだありません。</EmptyState>
      ) : (
        <ul className="series-list">
          {series.data.map((item) => (
            <li key={item.id}>
              <span className="series-list__cover">
                {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" /> : <span />}
              </span>
              <div className="series-list__body">
                <a href={href.seriesEdit(item.id)}>
                  <strong>{item.title}</strong>
                </a>
                <small>
                  {item.slug} ・ 公開記事 {item.publishedCount}件
                  {item.memberCount > item.publishedCount &&
                    `（下書き等 ${item.memberCount - item.publishedCount}件）`}
                  {item.publishedCount === 0 && " ・ noindex"}
                </small>
              </div>
              <div className="series-list__actions">
                <a href={href.seriesEdit(item.id)}>編集</a>
                {item.path && (
                  <a href={`${SITE}${item.path}`} target="_blank" rel="noopener noreferrer">
                    公開ページ ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface FormState {
  slug: string;
  title: string;
  description: string;
  coverMediaId: string | null;
  coverUrl: string | null;
  sortOrder: string;
}

function formFrom(item: CollectionAdminDto | null): FormState {
  return {
    slug: item?.slug ?? "",
    title: item?.title ?? "",
    description: item?.description ?? "",
    coverMediaId: item?.coverMediaId ?? null,
    coverUrl: item?.coverUrl ?? null,
    sortOrder: item ? String(item.sortOrder) : "",
  };
}

/** Create (`id` = "new") or edit one series. The slug is fixed after creation. */
export function SeriesEditor({ id }: { id: string }) {
  const creating = id === "new";
  useTitle(creating ? "新しいシリーズ" : "シリーズを編集");
  const toast = useToast();
  const existing = useResource(
    () => (creating ? Promise.resolve(null) : api.getCollection(id)),
    `collection:${id}`,
  );
  const [form, setForm] = useState<FormState | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  // The form starts from the loaded series once, then is the operator's.
  const loaded = existing.data !== undefined;
  if (loaded && form === null) {
    const initial = formFrom(existing.data ?? null);
    setForm(initial);
    setBaseline(JSON.stringify(initial));
  }
  const dirty = form !== null && JSON.stringify(form) !== baseline;
  useUnsavedWarning(dirty);

  if (existing.error)
    return (
      <>
        <PageHeader title="シリーズ" />
        <ErrorState error={existing.error} onRetry={() => void existing.reload()} />
      </>
    );
  if (!form) return <SkeletonRows rows={5} />;

  const set = (changes: Partial<FormState>): void =>
    setForm((current) => (current ? { ...current, ...changes } : current));

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!form) return;
    const sortOrder = form.sortOrder.trim() === "" ? null : Number(form.sortOrder);
    if (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
      toast.error(new Error("表示順は0以上の整数で入力してください"));
      return;
    }
    setBusy(true);
    try {
      const fields = {
        title: form.title,
        description: form.description.trim() === "" ? null : form.description,
        coverMediaId: form.coverMediaId,
      };
      const saved = creating
        ? await api.createCollection({ ...fields, sortOrder, slug: form.slug, kind: "series" })
        : await api.updateCollection(id, {
            ...fields,
            sortOrder: sortOrder ?? existing.data?.sortOrder ?? 0,
          });
      const next = formFrom(saved);
      setForm(next);
      setBaseline(JSON.stringify(next));
      toast.info(creating ? "シリーズを作成しました" : "シリーズを保存しました");
      if (creating) globalThis.location.hash = href.seriesEdit(saved.id);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  const item = existing.data;
  return (
    <>
      <PageHeader
        title={creating ? "新しいシリーズ" : item?.title}
        meta={
          item && (
            <>
              公開記事 {item.publishedCount}件{item.publishedCount === 0 && "（noindex）"}
              {item.path && (
                <>
                  {" ・ "}
                  <a href={`${SITE}${item.path}`} target="_blank" rel="noopener noreferrer">
                    公開ページ ↗
                  </a>
                </>
              )}
            </>
          )
        }
        actions={<a href={href.series()}>← シリーズ一覧</a>}
      />
      <form onSubmit={(event) => void submit(event)}>
        <Panel title="基本情報">
          <label className="field">
            <span>シリーズ名</span>
            <input
              required
              maxLength={80}
              value={form.title}
              onChange={(event) => set({ title: event.target.value })}
            />
          </label>
          <label className="field">
            <span>slug（URL: /collections/slug）{!creating && "・作成後は変更できません"}</span>
            <input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="travel-soundtrack"
              value={form.slug}
              disabled={!creating}
              onChange={(event) => set({ slug: event.target.value.toLowerCase() })}
            />
          </label>
          <label className="field field--wide">
            <span>説明文（400文字まで）</span>
            <textarea
              rows={6}
              maxLength={400}
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
            />
          </label>
          <label className="field">
            <span>表示順（小さいほど先。空欄なら末尾）</span>
            <input
              inputMode="numeric"
              value={form.sortOrder}
              onChange={(event) => set({ sortOrder: event.target.value })}
            />
          </label>
        </Panel>

        <Panel
          title="カバー画像"
          actions={
            <>
              <button type="button" onClick={() => setPicking((open) => !open)}>
                {picking ? "ライブラリを閉じる" : "ライブラリから選ぶ"}
              </button>
              {form.coverMediaId && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => set({ coverMediaId: null, coverUrl: null })}
                >
                  外す
                </button>
              )}
            </>
          }
        >
          {form.coverUrl ? (
            <img className="series-cover" src={form.coverUrl} alt="" />
          ) : (
            <p className="muted">未設定のときは、所属記事のカバー写真を使います。</p>
          )}
          {picking && (
            <CoverPicker
              onPick={(asset) => {
                set({ coverMediaId: asset.id, coverUrl: asset.thumbnailUrl ?? asset.url });
                setPicking(false);
              }}
            />
          )}
        </Panel>

        <div className="panel__foot">
          <button type="submit" className="primary" disabled={busy || (!creating && !dirty)}>
            {creating ? "作成する" : "保存する"}
          </button>
        </div>
      </form>
    </>
  );
}

function CoverPicker({ onPick }: { onPick: (asset: MediaAssetDto) => void }) {
  const [query, setQuery] = useState("");
  const library = usePagedSearch<MediaAssetDto>(
    (q, offset) => api.searchMedia(q, offset, 48),
    query,
  );
  return (
    <div>
      <input
        type="search"
        aria-label="写真を検索"
        placeholder="Slug・ファイル名で検索"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {Boolean(library.error) && (
        <ErrorState error={library.error} onRetry={() => library.reload()} />
      )}
      <div className="media-grid">
        {library.items.map((asset) => (
          <button
            key={asset.id}
            type="button"
            aria-label={`カバーにする：${asset.slug ?? asset.originalName ?? asset.id}`}
            onClick={() => onPick(asset)}
          >
            <MediaThumb url={asset.url} thumbnailUrl={asset.thumbnailUrl} />
          </button>
        ))}
      </div>
      {library.hasMore && (
        <button type="button" disabled={library.loading} onClick={() => library.more()}>
          {library.loading ? "読み込み中…" : "さらに表示"}
        </button>
      )}
    </div>
  );
}
