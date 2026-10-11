import { useRef, useState } from "react";
import type { MediaAssetDto } from "@tomokichi/contracts";
import { describeError } from "../lib/api";
import { IMAGE_ACCEPT, uploadImage } from "../lib/media-upload";

type Item = {
  id: number;
  file: File;
  slug: string;
  state: "queued" | "uploading" | "saved" | "duplicate" | "used" | "cancelled" | "failed";
  asset?: MediaAssetDto;
  error?: string;
};

export function MediaUpload({
  onAsset,
  disabled = false,
}: {
  onAsset: (asset: MediaAssetDto) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const counter = useRef(0);
  const patch = (id: number, changes: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  async function run(queue: Item[]): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      for (const item of queue) {
        patch(item.id, { state: "uploading", error: undefined });
        try {
          const result = await uploadImage(item.file, item.slug);
          patch(item.id, { state: result.duplicate ? "duplicate" : "saved", asset: result.asset });
          if (!result.duplicate) onAsset(result.asset);
        } catch (error) {
          patch(item.id, { state: "failed", error: describeError(error) });
        }
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="media-upload">
      <label className="button">
        画像を選択
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          disabled={busy || disabled}
          onChange={(event) => {
            const selected: Item[] = [...(event.target.files ?? [])].map((file) => ({
              id: ++counter.current,
              file,
              slug: "",
              state: "queued",
            }));
            event.target.value = "";
            setItems((current) => [...current, ...selected]);
          }}
        />
      </label>
      {items.some((item) => item.state === "queued") && (
        <button
          type="button"
          className="primary"
          disabled={busy || disabled}
          onClick={() => void run(items.filter((item) => item.state === "queued"))}
        >
          アップロード
        </button>
      )}
      {items.length > 0 && (
        <ul className="upload-results" aria-live="polite">
          {items.map((item) => (
            <li key={item.id}>
              {item.asset && <img src={item.asset.url} alt="" loading="lazy" />}
              <div className="upload-results__body">
                <strong>{item.file.name}</strong>
                {(item.state === "queued" || item.state === "failed") && (
                  <label className="field">
                    <span>公開画像Slug（任意）</span>
                    <input
                      aria-label={`${item.file.name}のSlug`}
                      placeholder="tokyo-trip"
                      maxLength={96}
                      value={item.slug}
                      disabled={busy || disabled}
                      onChange={(event) => patch(item.id, { slug: event.target.value })}
                    />
                  </label>
                )}
                {item.state === "uploading" && <span>アップロード中…</span>}
                {item.state === "saved" && <span className="ok-line">保存しました</span>}
                {item.state === "used" && <span className="ok-line">既存画像を選択しました</span>}
                {item.state === "cancelled" && <span className="muted">キャンセルしました</span>}
                {item.state === "duplicate" && item.asset && (
                  <>
                    <span>この画像はすでにアップロードされています</span>
                    <span className="muted">
                      {item.asset.originalName ?? item.asset.slug ?? item.asset.id}
                    </span>
                    <div className="row">
                      <button
                        type="button"
                        className="primary"
                        disabled={disabled}
                        onClick={() => {
                          onAsset(item.asset!);
                          patch(item.id, { state: "used" });
                        }}
                      >
                        既存画像を使用
                      </button>
                      <button type="button" onClick={() => patch(item.id, { state: "cancelled" })}>
                        キャンセル
                      </button>
                    </div>
                  </>
                )}
                {item.state === "failed" && (
                  <>
                    <span className="form-error">{item.error}</span>
                    <button
                      type="button"
                      disabled={busy || disabled}
                      onClick={() => void run([item])}
                    >
                      再試行
                    </button>
                  </>
                )}
                {item.state === "queued" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patch(item.id, { state: "cancelled" })}
                  >
                    キャンセル
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 &&
        !busy &&
        !items.some((item) => ["duplicate", "queued", "failed"].includes(item.state)) && (
          <button type="button" className="link" onClick={() => setItems([])}>
            結果を閉じる
          </button>
        )}
    </div>
  );
}
