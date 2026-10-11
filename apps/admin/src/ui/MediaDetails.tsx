import { useEffect, useRef, useState } from "react";
import type { MediaAssetDto } from "@tomokichi/contracts";
import { api, describeError } from "../lib/api";
import { convertImage, downloadImage, type ImageFormat } from "../lib/media-convert";
import { formatBytes } from "../lib/labels";

export function MediaDetails({
  asset,
  onSaved,
  onClose,
}: {
  asset: MediaAssetDto;
  onSaved: (asset: MediaAssetDto) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [slug, setSlug] = useState(asset.slug ?? "");
  const [format, setFormat] = useState<ImageFormat>("webp");
  const [quality, setQuality] = useState(90);
  const [maxWidth, setMaxWidth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const saved = await api.updateMediaSlug(asset.id, slug.trim() || null);
      onSaved(saved);
      setSlug(saved.slug ?? "");
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }
  async function download(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const source = await api.mediaFile(asset.id);
      const blob = await convertImage(source, {
        format,
        quality: quality / 100,
        ...(maxWidth ? { maxWidth: Number(maxWidth) } : {}),
      });
      const name = [...(asset.slug ?? asset.originalName?.replace(/\.[^.]+$/, "") ?? asset.id)]
        .map((character) =>
          character.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(character) ? "-" : character,
        )
        .join("");
      downloadImage(blob, `${name}.${format === "jpeg" ? "jpg" : format}`);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="media-details"
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="row">
        <h2>画像</h2>
        <button
          type="button"
          className="link"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          閉じる
        </button>
      </div>
      <img src={asset.url} alt={asset.originalName ?? ""} />
      <p>
        {asset.originalName ?? asset.id} ・ {formatBytes(asset.size)}
      </p>
      <label className="field">
        <span>公開画像Slug</span>
        <input
          value={slug}
          maxLength={96}
          placeholder="tokyo-trip"
          disabled={busy}
          onChange={(event) => setSlug(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || slug.trim() === (asset.slug ?? "")}
        onClick={() => void save()}
      >
        Slugを保存
      </button>
      {asset.slugUrl && (
        <a
          className="media-details__url"
          href={asset.slugUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {asset.slugUrl}
        </a>
      )}
      <fieldset disabled={busy} className="media-export">
        <legend>形式を変えてダウンロード</legend>
        <div className="form-grid">
          <label className="field">
            <span>出力形式</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as ImageFormat)}
            >
              <option value="webp">WebP (.webp)</option>
              <option value="jpeg">JPEG (.jpg)</option>
              <option value="png">PNG (.png)</option>
            </select>
          </label>
          <label className="field">
            <span>最大幅（px・任意）</span>
            <input
              type="number"
              min={1}
              step={1}
              value={maxWidth}
              onChange={(event) => setMaxWidth(event.target.value)}
            />
          </label>
        </div>
        {format !== "png" && (
          <label className="field">
            <span>品質 {quality}%</span>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={quality}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
          </label>
        )}
        {(asset.mimeType === "image/gif" ||
          asset.mimeType === "image/webp" ||
          asset.mimeType === "image/avif" ||
          asset.mimeType === "image/png") && (
          <p className="muted small">アニメーション画像は先頭フレームで出力します。</p>
        )}
        {format === "jpeg" && <p className="muted small">透明部分は白になります。</p>}
        <button type="button" className="primary" onClick={() => void download()}>
          ダウンロード
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </dialog>
  );
}
