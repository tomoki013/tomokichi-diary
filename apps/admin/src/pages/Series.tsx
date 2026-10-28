import { useEffect, useState, type FormEvent } from "react";
import {
  parseThemeMusic,
  THEME_MUSIC_PROVIDER_LABELS,
  type CollectionAdminDto,
  type CollectionArticleDefaultsDto,
  type MediaAssetDto,
  type TaxonomyDto,
} from "@tomokichi/contracts";
import { api } from "../lib/api";
import { experienceLabels } from "../lib/labels";
import { href } from "../lib/route";
import { seriesSiteState } from "../lib/series-site";
import { SitePublication } from "../ui/SitePublication";
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
  musicUrl: string;
  musicTitle: string;
  musicEnabled: boolean;
  defaults: CollectionArticleDefaultsDto;
}

function formFrom(item: CollectionAdminDto | null): FormState {
  return {
    slug: item?.slug ?? "",
    title: item?.title ?? "",
    description: item?.description ?? "",
    coverMediaId: item?.coverMediaId ?? null,
    coverUrl: item?.coverUrl ?? null,
    sortOrder: item ? String(item.sortOrder) : "",
    musicUrl: item?.themeMusic?.url ?? "",
    musicTitle: item?.themeMusic?.title ?? "",
    musicEnabled: item?.themeMusic?.enabled ?? false,
    defaults: item?.articleDefaults ?? { tagIds: [], categoryIds: [], experienceTags: [] },
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
  const taxonomy = useResource(() => api.taxonomy(), "reference:taxonomy");
  const publication = useResource(() => api.publicationStatus(), "publication");
  const reloadPublication = publication.reload;
  useEffect(() => {
    if (creating) return;
    const timer = setInterval(() => void reloadPublication(), 10000);
    return () => clearInterval(timer);
  }, [creating, reloadPublication]);

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
    const musicUrl = form.musicUrl.trim();
    if (musicUrl !== "" && !parseThemeMusic("apple_music", musicUrl)) {
      toast.error(
        new Error(
          "テーマ音楽のURLは、Apple Musicの曲・アルバム・プレイリストの共有URLにしてください",
        ),
      );
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
            // Cleared URL = no music; a switched-off one is kept for later.
            themeMusic:
              musicUrl === ""
                ? null
                : {
                    provider: "apple_music",
                    url: musicUrl,
                    title: form.musicTitle.trim() === "" ? null : form.musicTitle.trim(),
                    enabled: form.musicEnabled,
                  },
            articleDefaults: form.defaults,
          });
      const next = formFrom(saved);
      setForm(next);
      setBaseline(JSON.stringify(next));
      if (!creating) existing.setData(() => saved);
      toast.info(
        creating ? "シリーズを作成しました" : "シリーズを保存しました（サイトへの反映は別です）",
      );
      if (creating) globalThis.location.hash = href.seriesEdit(saved.id);
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

  const item = existing.data;
  const site = seriesSiteState(item?.updatedAt ?? null, publication.data, dirty);
  const sitePending =
    publication.data?.state === "queued" ||
    publication.data?.state === "building" ||
    publication.data?.state === "failed";
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

        {creating ? (
          <p className="muted">テーマ音楽と記事の既定は、作成後にこの画面で設定できます。</p>
        ) : (
          <>
            <ThemeMusicPanel form={form} set={set} />
            <DefaultsPanel
              taxonomy={taxonomy.data}
              defaults={form.defaults}
              suggested={item?.suggestedDefaults}
              onChange={(defaults) => set({ defaults })}
            />
          </>
        )}

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
            保存はDBへの記録だけです。シリーズページと所属記事のページは、サイトの反映（全ページの再生成）で変わります。記事の本文や版は変わりません。
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

type SetForm = (changes: Partial<FormState>) => void;

/**
 * The series' theme music: a share URL checked as it is typed, a player
 * loaded only when asked for, and a switch that keeps the URL when off.
 */
function ThemeMusicPanel({ form, set }: { form: FormState; set: SetForm }) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const url = form.musicUrl.trim();
  const player = url === "" ? null : parseThemeMusic("apple_music", url);
  const kindLabel = player
    ? { song: "曲", album: "アルバム", playlist: "プレイリスト" }[player.kind]
    : null;
  return (
    <Panel
      title="テーマ音楽"
      actions={
        url !== "" && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              set({ musicUrl: "", musicTitle: "", musicEnabled: false });
              setPreviewing(null);
            }}
          >
            音楽設定を解除
          </button>
        )
      }
    >
      <p className="muted small">
        シリーズページと所属記事に「音楽と一緒に読む」を出します。読者がボタンを押すまでプレーヤーは読み込まず、自動再生もしません。
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={form.musicEnabled}
          disabled={!player}
          onChange={(event) => set({ musicEnabled: event.target.checked })}
        />
        テーマ音楽を使用する
        {!player && <small className="muted">（有効なURLを入れると選べます）</small>}
      </label>
      <label className="field">
        <span>音楽サービス</span>
        <select value="apple_music" disabled>
          <option value="apple_music">{THEME_MUSIC_PROVIDER_LABELS.apple_music}</option>
        </select>
      </label>
      <label className="field field--wide">
        <span>Apple Musicの共有URL（曲・アルバム・プレイリスト）</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://music.apple.com/jp/album/…?i=…"
          value={form.musicUrl}
          aria-invalid={url !== "" && !player}
          aria-describedby="theme-music-check"
          onChange={(event) => {
            const next = event.target.value;
            // Pasting Apple's embed code keeps only its player URL.
            const src = /\ssrc="([^"]+)"/i.exec(next)?.[1];
            const parsed = parseThemeMusic("apple_music", src ?? next);
            set({
              musicUrl: src && parsed ? parsed.pageUrl : next,
              ...(next.trim() === "" ? { musicEnabled: false } : {}),
            });
            setPreviewing(null);
          }}
        />
        <small id="theme-music-check" className={url !== "" && !player ? "form-error" : "muted"}>
          {url === ""
            ? "未設定です。"
            : player
              ? `Apple Musicの${kindLabel}として認識しました。`
              : "Apple Musicの曲・アルバム・プレイリストの共有URLではありません。"}
        </small>
      </label>
      <label className="field">
        <span>表示名（任意・80文字まで）</span>
        <input
          maxLength={80}
          placeholder="例：旅のテーマ曲"
          value={form.musicTitle}
          onChange={(event) => set({ musicTitle: event.target.value })}
        />
      </label>
      {player && (
        <div className="stack">
          {previewing === player.embedUrl ? (
            <figure className="theme-music-preview">
              {/* The same frame the body's Apple Music players use: Apple's
                  player is cross-origin and needs scripts and its own storage. */}
              <iframe
                src={player.embedUrl}
                title={`Apple Musicの${kindLabel}（プレビュー）`}
                height={player.height}
                allow="encrypted-media *; clipboard-write"
                // oxlint-disable-next-line react/iframe-missing-sandbox
                sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </figure>
          ) : (
            <button type="button" onClick={() => setPreviewing(player.embedUrl)}>
              プレーヤーをプレビュー
            </button>
          )}
          <a href={player.pageUrl} target="_blank" rel="noopener noreferrer">
            Apple Musicで開く ↗
          </a>
        </div>
      )}
    </Panel>
  );
}

/**
 * What an article usually carries once it joins this series. The editor
 * fills these in when the series is ticked; nothing changes for articles
 * already in it.
 */
function DefaultsPanel({
  taxonomy,
  defaults,
  suggested,
  onChange,
}: {
  taxonomy: TaxonomyDto | undefined;
  defaults: CollectionArticleDefaultsDto;
  suggested: CollectionArticleDefaultsDto | undefined;
  onChange: (defaults: CollectionArticleDefaultsDto) => void;
}) {
  const [filter, setFilter] = useState("");
  const toggle = (key: keyof CollectionArticleDefaultsDto, value: string) =>
    onChange({
      ...defaults,
      [key]: defaults[key].includes(value)
        ? defaults[key].filter((item) => item !== value)
        : [...defaults[key], value],
    });
  const tagName = new Map(taxonomy?.tags.map((tag) => [tag.id, tag.name]) ?? []);
  const categoryName = new Map(taxonomy?.categories.map((c) => [c.id, c.name]) ?? []);
  const fresh = suggested && {
    tagIds: suggested.tagIds.filter((id) => !defaults.tagIds.includes(id)),
    categoryIds: suggested.categoryIds.filter((id) => !defaults.categoryIds.includes(id)),
    experienceTags: suggested.experienceTags.filter((t) => !defaults.experienceTags.includes(t)),
  };
  const suggestion = fresh
    ? [
        ...fresh.experienceTags.map((tag) => experienceLabels[tag] ?? tag),
        ...fresh.categoryIds.map((id) => categoryName.get(id) ?? id),
        ...fresh.tagIds.map((id) => `#${tagName.get(id) ?? id}`),
      ]
    : [];
  const query = filter.trim();
  const tags = (taxonomy?.tags ?? []).filter(
    (tag) =>
      defaults.tagIds.includes(tag.id) ||
      (query !== "" && (tag.name.includes(query) || tag.slug.includes(query.toLowerCase()))),
  );
  return (
    <Panel title="記事の既定（シリーズに入れたとき）">
      <p className="muted small">
        記事編集でこのシリーズを選ぶと、ここで選んだタグ・カテゴリー・体験タグが入ります。外すと、そのとき入ったものだけ戻ります。
      </p>
      {fresh && suggestion.length > 0 && (
        <p className="small">
          所属記事でよく使われています：{suggestion.join("、")}{" "}
          <button
            type="button"
            onClick={() =>
              onChange({
                tagIds: [...defaults.tagIds, ...fresh.tagIds],
                categoryIds: [...defaults.categoryIds, ...fresh.categoryIds],
                experienceTags: [...defaults.experienceTags, ...fresh.experienceTags],
              })
            }
          >
            既定に加える
          </button>
        </p>
      )}
      <fieldset className="chips">
        <legend className="field__label">体験タグ</legend>
        {Object.entries(experienceLabels).map(([tag, label]) => (
          <button
            key={tag}
            type="button"
            className="chip"
            aria-pressed={defaults.experienceTags.includes(tag)}
            onClick={() => toggle("experienceTags", tag)}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {!taxonomy ? (
        <SkeletonRows rows={2} />
      ) : (
        <>
          <fieldset className="field">
            <legend className="field__label">カテゴリー</legend>
            <div className="checks">
              {taxonomy.categories.map((category) => (
                <label key={category.id} className="check">
                  <input
                    type="checkbox"
                    checked={defaults.categoryIds.includes(category.id)}
                    onChange={() => toggle("categoryIds", category.id)}
                  />
                  {category.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend className="field__label">
              タグ（{defaults.tagIds.length}）
              <input
                type="search"
                className="inline-search"
                aria-label="タグを検索"
                placeholder="検索して追加"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </legend>
            <div className="checks checks--scroll">
              {tags.map((tag) => (
                <label key={tag.id} className="check">
                  <input
                    type="checkbox"
                    checked={defaults.tagIds.includes(tag.id)}
                    onChange={() => toggle("tagIds", tag.id)}
                  />
                  {tag.name}
                </label>
              ))}
              {tags.length === 0 && <span className="muted small">タグ名で検索してください。</span>}
            </div>
          </fieldset>
        </>
      )}
    </Panel>
  );
}
