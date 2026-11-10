import { useState } from "react";
import type { MediaAssetDto } from "@tomokichi/contracts";
import { useOp } from "../data/hooks";
import { Button, Empty, Loaded, TextInput } from "./parts";
import { MediaUpload } from "./MediaUpload";

/**
 * Picks one photo from the library, or uploads one on the spot. A sheet from
 * the bottom on a phone, a dialog on a wide screen.
 */
export function MediaPicker({
  title = "写真を選ぶ",
  onPick,
  onClose,
}: {
  title?: string;
  onPick: (asset: MediaAssetDto) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(60);
  const page = useOp("media.list", { query, offset: 0, limit });
  return (
    <dialog open className="sheet" aria-label={title}>
      <div className="sheet__body">
        <div className="spread">
          <h2>{title}</h2>
          <Button kind="quiet" onClick={onClose}>
            閉じる
          </Button>
        </div>
        <TextInput
          label="検索"
          type="search"
          value={query}
          onChange={setQuery}
          placeholder="slug・ファイル名・地域"
        />
        <MediaUpload onUploaded={onPick} />
        <Loaded resource={page} lines={3}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty>見つかりませんでした。</Empty>
            ) : (
              <>
                <div className="thumbs">
                  {data.items.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className="thumb"
                      onClick={() => onPick(asset)}
                      title={asset.slug ?? asset.originalName ?? asset.id}
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
      </div>
    </dialog>
  );
}
