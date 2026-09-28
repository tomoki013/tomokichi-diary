import { useState, type ChangeEvent } from "react";
import type { ArticleDetailDto, MediaAssetDto } from "@tomokichi/contracts";
import { api, type MediaRole, type MediaUsageInput } from "../../lib/api";
import { mediaRoleLabels } from "../../lib/labels";
import { useResource } from "../../ui/hooks";
import { Panel } from "../../ui/parts";
import { useToast } from "../../ui/toast";

function usagesFrom(article: ArticleDetailDto): MediaUsageInput[] {
  return article.media
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      mediaId: item.mediaId,
      role: item.role as MediaRole,
      sortOrder: item.sortOrder,
      alt: item.alt,
      caption: item.caption,
    }));
}

/** Measured in the browser so the page can reserve space; the Worker never decodes images. */
export async function measure(file: File): Promise<{ width: number; height: number } | undefined> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return undefined;
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/**
 * Alt text belongs to a usage, not to a file: the same photo says something
 * different in each article it appears in.
 */
export function MediaSection({
  article,
  onSaved,
}: {
  article: ArticleDetailDto;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [usages, setUsages] = useState<MediaUsageInput[]>(() => usagesFrom(article));
  const [baseline, setBaseline] = useState(() => JSON.stringify(usagesFrom(article)));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  // URLs of images added in this session, before the article is reloaded.
  const [known, setKnown] = useState<Record<string, string>>({});
  const library = useResource(
    () => (picking ? api.listMedia().then((r) => r.items) : Promise.resolve([] as MediaAssetDto[])),
    `media:${picking}`,
  );

  const normalized = usages.map((usage, index) => ({ ...usage, sortOrder: index }));
  const dirty = JSON.stringify(normalized) !== baseline;
  const missingAlt = usages.some((usage) => usage.alt.trim() === "");

  const urlOf = (mediaId: string): string =>
    known[mediaId] ??
    article.media.find((item) => item.mediaId === mediaId)?.url ??
    library.data?.find((item) => item.id === mediaId)?.url ??
    "";

  const add = (mediaId: string): void =>
    setUsages((current) =>
      current.some((usage) => usage.mediaId === mediaId)
        ? current
        : [
            ...current,
            {
              mediaId,
              role: current.some((usage) => usage.role === "cover") ? "inline" : "cover",
              sortOrder: current.length,
              alt: "",
              caption: null,
            },
          ],
    );

  const patch = (index: number, changes: Partial<MediaUsageInput>): void =>
    setUsages((current) =>
      current.map((usage, i) => (i === index ? { ...usage, ...changes } : usage)),
    );

  const move = (index: number, delta: -1 | 1): void =>
    setUsages((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  async function upload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    setBusy(true);
    try {
      for (const file of files) {
        const asset = await api.uploadMedia(file, await measure(file));
        library.setData((current) =>
          current?.some((item) => item.id === asset.id) ? current : [asset, ...(current ?? [])],
        );
        setKnown((current) => ({ ...current, [asset.id]: asset.url }));
        add(asset.id);
      }
      toast.info(`${files.length}枚アップロードしました`);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api.saveArticleMedia(article.id, normalized);
      setBaseline(JSON.stringify(normalized));
      toast.info("画像を保存しました");
      await onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={`画像（${usages.length}）`}
      actions={
        <>
          <label className="button">
            アップロード
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              disabled={busy}
              onChange={(event) => void upload(event)}
            />
          </label>
          <button type="button" onClick={() => setPicking((open) => !open)}>
            {picking ? "ライブラリを閉じる" : "ライブラリから選ぶ"}
          </button>
        </>
      }
    >
      {usages.length === 0 && <p className="muted">画像はまだありません。</p>}
      <ol className="media-usages">
        {usages.map((usage, index) => (
          <li key={usage.mediaId}>
            <img src={urlOf(usage.mediaId)} alt="" loading="lazy" />
            <div className="media-usages__fields">
              <div className="row">
                <select
                  aria-label="用途"
                  value={usage.role}
                  onChange={(event) => patch(index, { role: event.target.value as MediaRole })}
                >
                  {Object.entries(mediaRoleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="上へ"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="下へ"
                  onClick={() => move(index, 1)}
                  disabled={index === usages.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setUsages((current) => current.filter((_, i) => i !== index))}
                >
                  外す
                </button>
              </div>
              <input
                aria-label="代替テキスト"
                placeholder="代替テキスト（必須）"
                className={usage.alt.trim() === "" ? "invalid" : undefined}
                value={usage.alt}
                onChange={(event) => patch(index, { alt: event.target.value })}
              />
              <input
                aria-label="キャプション"
                placeholder="キャプション（任意）"
                value={usage.caption ?? ""}
                onChange={(event) => patch(index, { caption: event.target.value || null })}
              />
            </div>
          </li>
        ))}
      </ol>

      {picking && (
        <div className="media-grid">
          {library.loading && !library.data
            ? Array.from({ length: 12 }, (_, index) => <div key={index} className="skeleton" />)
            : (library.data ?? []).slice(0, 120).map((asset) => {
                const chosen = usages.some((usage) => usage.mediaId === asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    aria-pressed={chosen}
                    aria-label={`画像を追加（${asset.width ?? "?"}×${asset.height ?? "?"}）`}
                    onClick={() => {
                      setKnown((current) => ({ ...current, [asset.id]: asset.url }));
                      add(asset.id);
                    }}
                  >
                    <img src={asset.url} alt="" loading="lazy" />
                  </button>
                );
              })}
        </div>
      )}

      <div className="panel__foot">
        {missingAlt && <span className="form-error">代替テキストが空の画像があります</span>}
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty || missingAlt}
          onClick={() => void save()}
        >
          画像を保存
        </button>
      </div>
    </Panel>
  );
}
