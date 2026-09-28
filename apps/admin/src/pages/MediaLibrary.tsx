import { useState, type ChangeEvent } from "react";
import { api } from "../lib/api";
import { formatBytes } from "../lib/labels";
import { useResource, useTitle } from "../ui/hooks";
import { EmptyState, ErrorState, PageHeader } from "../ui/parts";
import { useToast } from "../ui/toast";
import { measure } from "./editor/MediaSection";

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
  const [busy, setBusy] = useState(false);

  async function upload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    setBusy(true);
    try {
      for (const file of files) {
        const asset = await api.uploadMedia(file, await measure(file));
        media.setData((current) =>
          current?.some((item) => item.id === asset.id) ? current : [asset, ...(current ?? [])],
        );
      }
      toast.info(`${files.length}枚アップロードしました`);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

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
      <PageHeader
        title="画像"
        meta={media.data && `${media.data.length}件`}
        actions={
          <label className="button primary">
            {busy ? "アップロード中…" : "アップロード"}
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              disabled={busy}
              onChange={(event) => void upload(event)}
            />
          </label>
        }
      />
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
            {(media.data ?? []).slice(0, shown).map((asset) => (
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
                  <button type="button" className="link" onClick={() => void copy(asset.url)}>
                    URL
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {(media.data?.length ?? 0) > shown && (
            <div className="more">
              <button type="button" onClick={() => setShown((count) => count + PAGE)}>
                さらに表示（残り {(media.data?.length ?? 0) - shown}）
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
