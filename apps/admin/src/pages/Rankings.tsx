import { useEffect, useState, type FormEvent } from "react";
import type {
  ArticleSummaryDto,
  MediaAssetDto,
  RankingAdminDto,
  RankingPhotoDto,
} from "@tomokichi/contracts";
import { api } from "../lib/api";
import { experienceLabels } from "../lib/labels";
import { href } from "../lib/route";
import { seriesSiteState } from "../lib/series-site";
import { SitePublication } from "../ui/SitePublication";
import { usePagedSearch, useResource, useTitle, useUnsavedWarning } from "../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";
import { useToast } from "../ui/toast";
import { MediaThumb } from "../ui/MediaThumb";

const MAX_PICKS = 15;

/**
 * "ともきち的ランキング" on the home page. Every ranking is listed here; one
 * with no published article in it simply does not appear on the site.
 */
export function RankingList() {
  useTitle("ランキング");
  const rankings = useResource(() => api.listRankings().then((r) => r.items), "rankings");
  const shown = rankings.data?.filter((item) => item.liveCount > 0).length ?? 0;

  return (
    <>
      <PageHeader
        title="ランキング"
        meta={rankings.data && `${rankings.data.length}件・サイトに表示 ${shown}件`}
        actions={
          <a className="button primary" href={href.rankingEdit("new")}>
            ＋ 新しいランキング
          </a>
        }
      />
      <p className="muted">
        トップページの「ともきち的ランキング」です。ランキングごとに写真を1枚選べます。公開中の記事が1本も入っていないランキングはサイトに出ません。並びは表示順の小さい順です。変更はサイトの次回反映で公開されます。
      </p>
      {rankings.error ? (
        <ErrorState error={rankings.error} onRetry={() => void rankings.reload()} />
      ) : !rankings.data ? (
        <SkeletonRows rows={6} />
      ) : rankings.data.length === 0 ? (
        <EmptyState>ランキングはまだありません。</EmptyState>
      ) : (
        <ul className="series-list">
          {rankings.data.map((item) => (
            <li key={item.id}>
              <span className="ranking-list__count" aria-hidden="true">
                {item.liveCount}
              </span>
              <div className="series-list__body">
                <a href={href.rankingEdit(item.id)}>
                  <strong>{item.title}</strong>
                </a>
                <small>
                  {item.note && `${item.note} ・ `}
                  {item.picks.length === 0
                    ? "記事なし（サイトに出ません）"
                    : `${item.picks.length}本${item.liveCount < item.picks.length ? `（公開中 ${item.liveCount}本）` : ""}`}
                  {item.experienceTag &&
                    ` ・ もっと読む：${experienceLabels[item.experienceTag] ?? item.experienceTag}`}
                </small>
              </div>
              <div className="series-list__actions">
                <a href={href.rankingEdit(item.id)}>編集</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface FormState {
  title: string;
  note: string;
  experienceTag: string;
  photoMediaId: string | null;
  photo: RankingPhotoDto | null;
  sortOrder: string;
  picks: { articleId: string; comment: string }[];
}

function formFrom(item: RankingAdminDto | null): FormState {
  return {
    title: item?.title ?? "",
    note: item?.note ?? "",
    experienceTag: item?.experienceTag ?? "",
    photoMediaId: item?.photo?.mediaId ?? null,
    photo: item?.photo ?? null,
    sortOrder: item ? String(item.sortOrder) : "",
    picks: item?.picks.map(({ articleId, comment }) => ({ articleId, comment })) ?? [],
  };
}

/** Create (`id` = "new") or edit one ranking: its heading, then the ranked articles. */
export function RankingEditor({ id }: { id: string }) {
  const creating = id === "new";
  useTitle(creating ? "新しいランキング" : "ランキングを編集");
  const toast = useToast();
  const existing = useResource(
    () => (creating ? Promise.resolve(null) : api.getRanking(id)),
    `ranking:${id}`,
  );
  const articles = useResource(
    () => api.listArticles().then((r) => r.items.filter((a) => a.kind === "article")),
    "articles",
  );
  const [form, setForm] = useState<FormState | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const publication = useResource(() => api.publicationStatus(), "publication");
  const reloadPublication = publication.reload;
  useEffect(() => {
    if (creating) return;
    const timer = setInterval(() => void reloadPublication(), 10000);
    return () => clearInterval(timer);
  }, [creating, reloadPublication]);

  // The form starts from the loaded ranking once, then is the operator's.
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
        <PageHeader title="ランキング" />
        <ErrorState error={existing.error} onRetry={() => void existing.reload()} />
      </>
    );
  if (!form) return <SkeletonRows rows={5} />;

  const set = (changes: Partial<FormState>): void =>
    setForm((current) => (current ? { ...current, ...changes } : current));
  const setPicks = (update: (picks: FormState["picks"]) => FormState["picks"]): void =>
    setForm((current) => (current ? { ...current, picks: update(current.picks) } : current));

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!form) return;
    const sortOrder = form.sortOrder.trim() === "" ? undefined : Number(form.sortOrder);
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
      toast.error(new Error("表示順は0以上の整数で入力してください"));
      return;
    }
    setBusy(true);
    try {
      const input = {
        title: form.title,
        note: form.note,
        experienceTag: form.experienceTag === "" ? null : form.experienceTag,
        photoMediaId: form.photoMediaId,
        picks: form.picks,
        ...(sortOrder === undefined ? {} : { sortOrder }),
      };
      const saved = creating ? await api.createRanking(input) : await api.updateRanking(id, input);
      const next = formFrom(saved);
      setForm(next);
      setBaseline(JSON.stringify(next));
      if (!creating) existing.setData(() => saved);
      toast.info(
        creating
          ? "ランキングを作成しました"
          : "ランキングを保存しました（サイトへの反映は別です）",
      );
      if (creating) globalThis.location.hash = href.rankingEdit(saved.id);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  async function publishSite(): Promise<void> {
    setBusy(true);
    try {
      await api.retryPublication();
      await publication.reload();
      toast.info("サイトへの反映を受け付けました");
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  const articleById = new Map(articles.data?.map((article) => [article.id, article]) ?? []);
  const item = existing.data;
  const site = seriesSiteState(item?.updatedAt ?? null, publication.data, dirty);
  const sitePending =
    publication.data?.state === "queued" ||
    publication.data?.state === "building" ||
    publication.data?.state === "failed";
  const move = (from: number, to: number) =>
    setPicks((picks) => {
      const next = [...picks];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });

  return (
    <>
      <PageHeader
        title={creating ? "新しいランキング" : item?.title}
        meta={item && `サイトに出る記事 ${item.liveCount}本`}
        actions={<a href={href.rankings()}>← ランキング一覧</a>}
      />
      <form onSubmit={(event) => void submit(event)}>
        <Panel title="見出し">
          <label className="field">
            <span>ランキング名（60文字まで）</span>
            <input
              required
              maxLength={60}
              value={form.title}
              onChange={(event) => set({ title: event.target.value })}
            />
          </label>
          <label className="field">
            <span>手書き風の添え書き（40文字まで・任意）</span>
            <input
              maxLength={40}
              placeholder="例：今だから笑える"
              value={form.note}
              onChange={(event) => set({ note: event.target.value })}
            />
          </label>
          <label className="field">
            <span>「もっと読む」の行き先（体験タグの一覧）</span>
            <select
              value={form.experienceTag}
              onChange={(event) => set({ experienceTag: event.target.value })}
            >
              <option value="">出さない</option>
              {Object.entries(experienceLabels).map(([tag, label]) => (
                <option key={tag} value={tag}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>表示順（小さいほど左。空欄なら{creating ? "末尾" : "そのまま"}）</span>
            <input
              inputMode="numeric"
              value={form.sortOrder}
              onChange={(event) => set({ sortOrder: event.target.value })}
            />
          </label>
        </Panel>

        <Panel
          title="ランキング写真"
          actions={
            <>
              <button type="button" onClick={() => setPickingPhoto((open) => !open)}>
                {pickingPhoto ? "ライブラリを閉じる" : "ライブラリから選ぶ"}
              </button>
              {form.photoMediaId && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => set({ photoMediaId: null, photo: null })}
                >
                  外す
                </button>
              )}
            </>
          }
        >
          {form.photo ? (
            <div className="ranking-photo-preview">
              <MediaThumb url={form.photo.url} thumbnailUrl={form.photo.thumbnailUrl} />
              <span className="muted small">{form.photo.label}</span>
            </div>
          ) : (
            <p className="muted">写真は未選択です。選ぶとランキングカードに1枚表示されます。</p>
          )}
          {pickingPhoto && (
            <RankingPhotoPicker
              onPick={(asset) => {
                const photo: RankingPhotoDto = {
                  mediaId: asset.id,
                  url: asset.url,
                  thumbnailUrl: asset.thumbnailUrl ?? null,
                  label: asset.slug ?? asset.originalName ?? asset.id,
                };
                set({ photoMediaId: asset.id, photo });
                setPickingPhoto(false);
              }}
            />
          )}
        </Panel>

        <Panel title={`順位（${form.picks.length}/${MAX_PICKS}）`}>
          <p className="muted small">
            1位から順に並べます。一言は空欄なら記事タイトルだけが出ます。下書きの記事も入れておけますが、公開されるまでサイトには出ません。
          </p>
          {form.picks.length === 0 ? (
            <p className="muted">まだ記事が入っていません。下の検索から追加してください。</p>
          ) : (
            <ol className="ranking-picks">
              {form.picks.map((pick, index) => {
                const article = articleById.get(pick.articleId);
                const fromSaved = item?.picks.find((p) => p.articleId === pick.articleId);
                const live = article?.isLive ?? fromSaved?.live ?? false;
                return (
                  <li key={pick.articleId}>
                    <span className="ranking-picks__rank">{index + 1}</span>
                    <div className="ranking-picks__body">
                      <strong>
                        {article?.title ?? fromSaved?.title ?? pick.articleId}
                        {!live && <Badge>未公開</Badge>}
                      </strong>
                      <small className="muted">{article?.slug ?? fromSaved?.slug}</small>
                      <input
                        aria-label={`${index + 1}位の一言`}
                        maxLength={80}
                        placeholder="一言（なぜこの順位か・80文字まで）"
                        value={pick.comment}
                        onChange={(event) =>
                          setPicks((picks) =>
                            picks.map((p, i) =>
                              i === index ? { ...p, comment: event.target.value } : p,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="ranking-picks__actions">
                      <button
                        type="button"
                        aria-label={`${index + 1}位を上へ`}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`${index + 1}位を下へ`}
                        disabled={index === form.picks.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setPicks((picks) => picks.filter((_, i) => i !== index))}
                      >
                        外す
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {form.picks.length < MAX_PICKS && (
            <ArticlePicker
              articles={articles.data}
              error={articles.error}
              onRetry={() => void articles.reload()}
              taken={new Set(form.picks.map((pick) => pick.articleId))}
              onPick={(article) =>
                setPicks((picks) => [...picks, { articleId: article.id, comment: "" }])
              }
            />
          )}
        </Panel>

        <div className="panel__foot">
          <button type="submit" className="primary" disabled={busy || (!creating && !dirty)}>
            {creating ? "作成する" : "保存する"}
          </button>
        </div>
      </form>

      {!creating && (
        <Panel title="サイトへの反映">
          <dl className="article-state">
            <div>
              <dt>DB</dt>
              <dd>
                <span
                  className={`state-dot state-dot--${dirty ? "warn" : "ok"}`}
                  aria-hidden="true"
                />
                {dirty ? "未保存の変更があります" : "保存済み"}
              </dd>
            </div>
            <div>
              <dt>サイト</dt>
              <dd>
                <span className={`state-dot state-dot--${site.tone}`} aria-hidden="true" />
                {site.text}
              </dd>
            </div>
          </dl>
          <p className="muted small">
            保存はDBへの記録だけです。トップページは、サイトの反映（全ページの再生成）で変わります。記事の本文や版は変わりません。
          </p>
          {sitePending && (
            <SitePublication
              publication={publication}
              disabled={busy}
              onRetry={() => void publishSite()}
            />
          )}
          {site.canPublish && (
            <button type="button" disabled={busy} onClick={() => void publishSite()}>
              サイトに反映する
            </button>
          )}
        </Panel>
      )}
    </>
  );
}

/** Finds an article by title, slug or URL; the ones already ranked are left out. */
function ArticlePicker({
  articles,
  error,
  onRetry,
  taken,
  onPick,
}: {
  articles: ArticleSummaryDto[] | undefined;
  error: unknown;
  onRetry: () => void;
  taken: ReadonlySet<string>;
  onPick: (article: ArticleSummaryDto) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches =
    q === ""
      ? []
      : (articles ?? [])
          .filter(
            (article) =>
              !taken.has(article.id) &&
              (article.title.toLowerCase().includes(q) ||
                article.slug.includes(q) ||
                (article.path ?? "").includes(q)),
          )
          .slice(0, 12);
  return (
    <div className="ranking-picker">
      <input
        type="search"
        aria-label="記事を検索して追加"
        placeholder="記事を検索して追加（タイトル / slug）"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {Boolean(error) && <ErrorState error={error} onRetry={onRetry} />}
      {!articles && !error && q !== "" && <SkeletonRows rows={2} />}
      {matches.length > 0 && (
        <ul>
          {matches.map((article) => (
            <li key={article.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(article);
                  setQuery("");
                }}
              >
                <span>
                  {article.title}
                  {!article.isLive && <Badge>未公開</Badge>}
                </span>
                <small className="muted">{article.slug}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {articles && q !== "" && matches.length === 0 && (
        <p className="muted small">見つかりません。</p>
      )}
    </div>
  );
}

function RankingPhotoPicker({ onPick }: { onPick: (asset: MediaAssetDto) => void }) {
  const [query, setQuery] = useState("");
  const library = usePagedSearch<MediaAssetDto>(
    (q, offset) => api.searchMedia(q, offset, 48),
    query,
  );
  return (
    <div className="ranking-photo-picker">
      <input
        type="search"
        aria-label="ランキング写真を検索"
        placeholder="Slug・ファイル名・エリアで検索"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {Boolean(library.error) && (
        <ErrorState error={library.error} onRetry={() => library.reload()} />
      )}
      {library.loading && library.items.length === 0 ? (
        <SkeletonRows rows={3} />
      ) : library.items.length === 0 ? (
        <p className="muted small">選べる画像がありません。</p>
      ) : (
        <div className="ranking-photo-picker__grid">
          {library.items.map((asset) => (
            <button
              key={asset.id}
              type="button"
              aria-label={`ランキング写真にする：${asset.slug ?? asset.originalName ?? asset.id}`}
              onClick={() => onPick(asset)}
            >
              <MediaThumb
                url={asset.url}
                thumbnailUrl={asset.thumbnailUrl}
                width={asset.width}
                height={asset.height}
              />
            </button>
          ))}
        </div>
      )}
      {library.hasMore && (
        <button type="button" disabled={library.loading} onClick={() => library.more()}>
          {library.loading ? "読み込み中…" : "さらに表示"}
        </button>
      )}
    </div>
  );
}
