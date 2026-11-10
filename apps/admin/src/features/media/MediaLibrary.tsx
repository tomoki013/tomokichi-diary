import { useState } from "react";
import type { MediaAssetDto } from "@tomokichi/contracts";
import { downloadOriginal, op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { copyText } from "../../lib/clipboard";
import { formatBytes } from "../../lib/labels";
import { MediaUpload } from "../../ui/MediaUpload";
import { Button, Check, Empty, Loaded, Page, Panel, TextInput } from "../../ui/parts";
import { useToast } from "../../ui/toast";

/** The photo library: search, upload, and each photo's public name. */
export function MediaLibrary() {
  useTitle("写真");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(60);
  const [open, setOpen] = useState<MediaAssetDto | null>(null);
  const page = useOp("media.list", { query, offset: 0, limit });
  const hashes = useOp("media.hashStatus");
  return (
    <Page title="写真">
      <Panel title="写真を上げる">
        <MediaUpload onUploaded={setOpen} />
      </Panel>
      <TextInput
        label="検索"
        type="search"
        value={query}
        onChange={setQuery}
        placeholder="slug・ファイル名・地域（京都 など）"
      />
      <Loaded resource={page} lines={4}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty>見つかりませんでした。</Empty>
          ) : (
            <>
              <p className="muted">{data.total.toLocaleString()}枚</p>
              <div className="thumbs">
                {data.items.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    className={`thumb${open?.id === asset.id ? " is-on" : ""}`}
                    onClick={() => setOpen(asset)}
                  >
                    <img src={asset.thumbnailUrl ?? asset.url} alt="" loading="lazy" />
                    <span className="thumb__label">{asset.slug ?? asset.originalName}</span>
                  </button>
                ))}
              </div>
              {data.nextOffset !== null && (
                <Button onClick={() => setLimit((n) => n + 60)}>さらに表示</Button>
              )}
            </>
          )
        }
      </Loaded>
      {hashes.data && hashes.data.pending > 0 && (
        <p className="muted">
          重複確認: {hashes.data.verified}/{hashes.data.total} 枚済み
        </p>
      )}
      {open && <Details key={open.id} asset={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function Details({ asset, onClose }: { asset: MediaAssetDto; onClose: () => void }) {
  const [slug, setSlug] = useState(asset.slug ?? "");
  const [ai, setAi] = useState(asset.aiGenerated);
  const { busy, run } = useAction();
  const toast = useToast();
  const url = asset.slugUrl ?? asset.url;
  return (
    <dialog open className="sheet" aria-label="写真の情報">
      <div className="sheet__body">
        <div className="spread">
          <h2>{asset.slug ?? asset.originalName ?? "写真"}</h2>
          <Button kind="quiet" onClick={onClose}>
            閉じる
          </Button>
        </div>
        <img src={asset.url} alt="" style={{ maxWidth: "100%", borderRadius: 8 }} />
        <p className="muted">
          {asset.width}×{asset.height} · {formatBytes(asset.size)} · {asset.mimeType}
          {asset.originalName ? ` · ${asset.originalName}` : ""}
        </p>
        <div className="inline">
          <Button
            onClick={() =>
              void copyText(`![](${url})`).then(() => toast.info("本文用の書き方をコピーしました"))
            }
          >
            本文用にコピー
          </Button>
          <Button
            kind="quiet"
            onClick={() =>
              void downloadOriginal(
                asset.id,
                asset.originalName ?? `${asset.slug ?? asset.id}`,
              ).catch((e: unknown) => toast.error(e))
            }
          >
            元画像を保存
          </Button>
        </div>
        <TextInput
          label="公開画像Slug"
          value={slug}
          onChange={setSlug}
          hint="URL が変わります。本文に入れた古い URL は自動で新しい方に向きます"
        />
        <Check label="画像生成 AI で作った（ギャラリーに出さない）" checked={ai} onChange={setAi} />
        <Button
          kind="primary"
          busy={busy === "save"}
          disabled={slug === (asset.slug ?? "") && ai === asset.aiGenerated}
          onClick={() =>
            void run(
              "save",
              () =>
                op("media.update", {
                  mediaId: asset.id,
                  ...(slug !== (asset.slug ?? "") ? { slug: slug.trim() || null } : {}),
                  ...(ai !== asset.aiGenerated ? { aiGenerated: ai } : {}),
                }),
              { done: "保存しました", touches: ["media"] },
            )
          }
        >
          保存
        </Button>
      </div>
    </dialog>
  );
}
