import { useEffect, useState, type ChangeEvent } from "react";
import type { ArticleDetailDto, MediaAssetDto } from "@tomokichi/contracts";
import { api, type MediaUsageInput } from "../api";

/**
 * Alt text is edited per usage, not per asset: the same photo means something
 * different in each article it appears in (instruction §25).
 */
export function MediaPanel({
  article,
  busy,
  onSave,
  onError,
}: {
  article: ArticleDetailDto;
  busy: boolean;
  onSave: (media: MediaUsageInput[]) => void;
  onError: (error: unknown) => void;
}) {
  const [library, setLibrary] = useState<MediaAssetDto[]>([]);
  const [usages, setUsages] = useState<MediaUsageInput[]>(() =>
    article.media.map((item) => ({
      mediaId: item.mediaId,
      role: item.role as MediaUsageInput["role"],
      sortOrder: item.sortOrder,
      alt: item.alt,
      caption: item.caption,
    })),
  );

  useEffect(() => {
    api.listMedia().then((response) => setLibrary(response.items), onError);
  }, [onError]);

  async function upload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      // Dimensions are measured here so the page can reserve space and avoid
      // layout shift; the Worker never decodes the image.
      const bitmap = await createImageBitmap(file).catch(() => null);
      const asset = await api.uploadMedia(
        file,
        bitmap ? { width: bitmap.width, height: bitmap.height } : undefined,
      );
      setLibrary((current) =>
        current.some((item) => item.id === asset.id) ? current : [asset, ...current],
      );
      setUsages((current) =>
        current.some((usage) => usage.mediaId === asset.id)
          ? current
          : [
              ...current,
              {
                mediaId: asset.id,
                role: current.some((usage) => usage.role === "cover") ? "inline" : "cover",
                sortOrder: current.length,
                alt: "",
                caption: null,
              },
            ],
      );
    } catch (error) {
      onError(error);
    } finally {
      event.target.value = "";
    }
  }

  const urlOf = (mediaId: string): string =>
    library.find((item) => item.id === mediaId)?.url ??
    article.media.find((item) => item.mediaId === mediaId)?.url ??
    "";

  const patch = (index: number, changes: Partial<MediaUsageInput>): void =>
    setUsages(usages.map((usage, i) => (i === index ? { ...usage, ...changes } : usage)));

  return (
    <div className="panel">
      <h2>画像</h2>
      <label>
        <span>アップロード</span>
        <input type="file" accept="image/*" onChange={(event) => void upload(event)} />
      </label>

      {usages.map((usage, index) => (
        <div key={usage.mediaId} style={{ display: "flex", gap: "0.8rem", marginBottom: "0.8rem" }}>
          <img
            src={urlOf(usage.mediaId)}
            alt=""
            width={110}
            height={73}
            style={{ objectFit: "cover", borderRadius: 6 }}
          />
          <div style={{ flex: 1 }}>
            <div className="row">
              <select
                value={usage.role}
                onChange={(event) =>
                  patch(index, { role: event.target.value as MediaUsageInput["role"] })
                }
                style={{ width: "8rem" }}
              >
                <option value="cover">cover</option>
                <option value="inline">inline</option>
                <option value="gallery">gallery</option>
                <option value="og">og</option>
              </select>
              <button
                className="danger"
                onClick={() => setUsages(usages.filter((_, i) => i !== index))}
              >
                外す
              </button>
            </div>
            <label style={{ marginTop: "0.4rem" }}>
              <span>代替テキスト（必須）</span>
              <input
                value={usage.alt}
                onChange={(event) => patch(index, { alt: event.target.value })}
              />
            </label>
          </div>
        </div>
      ))}

      <div className="row">
        <button
          disabled={busy}
          onClick={() => onSave(usages.map((usage, index) => ({ ...usage, sortOrder: index })))}
        >
          画像を保存
        </button>
      </div>

      <details style={{ marginTop: "1rem" }}>
        <summary className="muted">アップロード済みの画像から選ぶ（{library.length}）</summary>
        <div className="media-grid" style={{ marginTop: "0.6rem" }}>
          {library.slice(0, 60).map((asset) => (
            <button
              key={asset.id}
              aria-label={`画像を追加 (${asset.width ?? "?"}×${asset.height ?? "?"})`}
              aria-pressed={usages.some((usage) => usage.mediaId === asset.id)}
              onClick={() =>
                setUsages((current) =>
                  current.some((usage) => usage.mediaId === asset.id)
                    ? current
                    : [
                        ...current,
                        {
                          mediaId: asset.id,
                          role: "inline",
                          sortOrder: current.length,
                          alt: "",
                          caption: null,
                        },
                      ],
                )
              }
            >
              <img src={asset.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
