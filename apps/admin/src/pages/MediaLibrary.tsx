import { useState } from "react";
import type { MediaAssetDto } from "@tomokichi/contracts";
import { api } from "../lib/api";
import { formatBytes } from "../lib/labels";
import { useResource, useTitle } from "../ui/hooks";
import { EmptyState, ErrorState, PageHeader } from "../ui/parts";
import { useToast } from "../ui/toast";
import { matchesMedia } from "../lib/media-upload";
import { MediaUpload } from "../ui/MediaUpload";
import { MediaDetails } from "../ui/MediaDetails";

const PAGE = 60;

/**
 * Every uploaded image. Which article uses a photo, and with what alt text, is
 * decided in the article editor; this is where files arrive and are found.
 */
export function MediaLibrary() {
  useTitle("画像");
  const toast = useToast();
  const media = useResource(() => api.listMedia().then((r) => r.items), "media");
  const [shown, setShown] = useState(PAGE);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MediaAssetDto | null>(null);
  const hashes = useResource(() => api.mediaHashStatus(), "media-hashes");
  const addAsset = (asset: MediaAssetDto): void => {
    media.setData((current) =>
      current?.some((item) => item.id === asset.id) ? current : [asset, ...(current ?? [])],
    );
    void hashes.reload();
  };
  const filtered = (media.data ?? []).filter((asset) => matchesMedia(asset, query));

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
      <PageHeader title="画像" meta={media.data && `${media.data.length}件`} />
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
          placeholder="Slug・ファイル名・URLで検索"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setShown(PAGE);
          }}
        />
      </div>
      {media.error ? (
        <ErrorState error={media.error} onRetry={() => void media.reload()} />
      ) : media.loading && !media.data ? (
        <div className="library">
          {Array.from({ length: 18 }, (_, index) => (
            <div key={index} className="skeleton library__skeleton" />
          ))}
        </div>
      ) : media.data?.length === 0 ? (
        <EmptyState>画像はまだありません。</EmptyState>
      ) : (
        <>
          <ul className="library">
            {filtered.slice(0, shown).map((asset) => (
              <li key={asset.id}>
                <img
                  src={asset.url}
                  alt=""
                  loading="lazy"
                  width={asset.width ?? undefined}
                  height={asset.height ?? undefined}
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
          {filtered.length === 0 && <EmptyState>該当する画像はありません。</EmptyState>}
          {filtered.length > shown && (
            <div className="more">
              <button type="button" onClick={() => setShown((count) => count + PAGE)}>
                さらに表示（残り {filtered.length - shown}）
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
            media.setData((current) =>
              current?.map((item) => (item.id === asset.id ? asset : item)),
            );
            setSelected(asset);
            toast.info("Slugを保存しました");
          }}
        />
      )}
    </>
  );
}
