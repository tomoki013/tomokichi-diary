import { useState } from "react";
import type { MediaAssetDto } from "@tomokichi/contracts";
import { api } from "../lib/api";
import { formatBytes } from "../lib/labels";
import { usePagedSearch, useResource, useTitle } from "../ui/hooks";
import { EmptyState, ErrorState, PageHeader } from "../ui/parts";
import { useToast } from "../ui/toast";
import { MediaUpload } from "../ui/MediaUpload";
import { MediaDetails } from "../ui/MediaDetails";
import { MediaThumb } from "../ui/MediaThumb";

/**
 * Every uploaded image. Which article uses a photo, and with what alt text, is
 * decided in the article editor; this is where files arrive and are found.
 */
export function MediaLibrary() {
  useTitle("画像");
  const toast = useToast();
  const [query, setQuery] = useState("");
  // Searched and paged on the server: the library is hundreds of photos, and
  // the browser only ever holds the pages the operator has scrolled to.
  const media = usePagedSearch((q, offset) => api.searchMedia(q, offset), query);
  const [selected, setSelected] = useState<MediaAssetDto | null>(null);
  const hashes = useResource(() => api.mediaHashStatus(), "media-hashes");
  const addAsset = (asset: MediaAssetDto): void => {
    media.setItems((current) =>
      current.some((item) => item.id === asset.id) ? current : [asset, ...current],
    );
    void hashes.reload();
  };

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      toast.info("URL をコピーしました");
    } catch (error) {
      toast.error(error);
    }
  }

  return (
    <>
      <PageHeader title="画像" meta={hashes.data ? `${hashes.data.total}件` : undefined} />
      <MediaUpload onAsset={addAsset} />
      {hashes.data && (hashes.data.pending > 0 || hashes.data.uploads > 0) && (
        <output className="media-notice">
          ハッシュ未検証：{hashes.data.pending}件 ・ 保存処理待ち：{hashes.data.uploads}件
        </output>
      )}
      {hashes.error && <ErrorState error={hashes.error} onRetry={() => void hashes.reload()} />}
      <div className="toolbar">
        <input
          type="search"
          aria-label="画像を検索"
          placeholder="Slug・ファイル名・エリアで検索（スペースで絞り込み）"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {media.total !== null && query.trim() !== "" && (
          <span className="muted">{media.total}件</span>
        )}
      </div>
      {media.error && media.items.length === 0 ? (
        <ErrorState error={media.error} onRetry={() => media.reload()} />
      ) : media.loading && media.items.length === 0 ? (
        <div className="library">
          {Array.from({ length: 18 }, (_, index) => (
            <div key={index} className="skeleton library__skeleton" />
          ))}
        </div>
      ) : media.items.length === 0 ? (
        <EmptyState>
          {query.trim() === "" ? "画像はまだありません。" : "該当する画像はありません。"}
        </EmptyState>
      ) : (
        <>
          <ul className="library">
            {media.items.map((asset) => (
              <li key={asset.id}>
                <MediaThumb
                  url={asset.url}
                  thumbnailUrl={asset.thumbnailUrl}
                  width={asset.width}
                  height={asset.height}
                />
                <div className="library__meta">
                  <span>
                    {asset.width && asset.height ? `${asset.width}×${asset.height}` : "サイズ不明"}
                    ・{formatBytes(asset.size)}
                  </span>
                  <button
                    type="button"
                    className="link"
                    onClick={() => void copy(asset.slugUrl ?? asset.url)}
                  >
                    URL
                  </button>
                </div>
                <div className="library__name">{asset.slug ?? asset.originalName ?? asset.id}</div>
                <button
                  type="button"
                  className="library__details"
                  onClick={() => setSelected(asset)}
                >
                  詳細・形式変換
                </button>
              </li>
            ))}
          </ul>
          {media.error && <ErrorState error={media.error} onRetry={() => media.more()} />}
          {media.hasMore && (
            <div className="more">
              <button type="button" disabled={media.loading} onClick={() => media.more()}>
                {media.loading
                  ? "読み込み中…"
                  : `さらに表示（残り ${(media.total ?? 0) - media.items.length}）`}
              </button>
            </div>
          )}
        </>
      )}
      {selected && (
        <MediaDetails
          key={selected.id}
          asset={selected}
          onClose={() => setSelected(null)}
          onSaved={(asset) => {
            media.setItems((current) =>
              current.map((item) => (item.id === asset.id ? asset : item)),
            );
            setSelected(asset);
            toast.info("画像の設定を保存しました");
          }}
        />
      )}
    </>
  );
}
