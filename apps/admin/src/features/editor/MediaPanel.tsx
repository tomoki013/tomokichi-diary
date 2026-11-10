import { useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction } from "../../data/hooks";
import { mediaRoleLabels } from "../../lib/labels";
import { MediaPicker } from "../../ui/MediaPicker";
import { Button, Empty, Panel, Select, TextInput } from "../../ui/parts";

type Role = keyof typeof mediaRoleLabels;
interface Usage {
  mediaId: string;
  url: string;
  role: Role;
  alt: string;
  caption: string;
}
const roles = Object.entries(mediaRoleLabels).map(([value, label]) => ({
  value: value as Role,
  label,
}));

const fromArticle = (article: ArticleDetailDto): Usage[] =>
  article.media.map((m) => ({
    mediaId: m.mediaId,
    url: m.thumbnailUrl ?? m.url,
    role: m.role as Role,
    alt: m.alt,
    caption: m.caption ?? "",
  }));

/**
 * The photos a piece uses: the cover, body photos and their descriptions.
 * Photos put in the body are added here on save; this is where the cover and
 * the words for each are decided.
 */
export function MediaPanel({ article }: { article: ArticleDetailDto }) {
  const [items, setItems] = useState(() => fromArticle(article));
  const [picking, setPicking] = useState(false);
  const { busy, run } = useAction();
  const dirty = JSON.stringify(items) !== JSON.stringify(fromArticle(article));
  const set = (index: number, change: Partial<Usage>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));
  async function save() {
    await run(
      "save",
      () =>
        op("article.setMedia", {
          articleId: article.id,
          media: items.map((item, index) => ({
            mediaId: item.mediaId,
            role: item.role,
            sortOrder: index,
            alt: item.alt,
            caption: item.caption.trim() || null,
          })),
        }),
      { done: "写真を保存しました", touches: ["article", "note"] },
    );
  }
  return (
    <Panel
      id="media"
      title="写真"
      hint={`${items.length}枚`}
      collapsible
      actions={
        dirty ? (
          <Button kind="primary" busy={busy === "save"} onClick={() => void save()}>
            保存
          </Button>
        ) : undefined
      }
    >
      {items.length === 0 && <Empty>まだ写真がありません。</Empty>}
      {items.map((item, index) => (
        <div key={item.mediaId} className="media-line">
          <img src={item.url} alt="" loading="lazy" />
          <div className="stack">
            <Select
              label="使い方"
              value={item.role}
              options={roles}
              onChange={(role) => set(index, { role })}
            />
            <TextInput
              label="代替テキスト"
              value={item.alt}
              onChange={(alt) => set(index, { alt })}
              max={300}
            />
            <TextInput
              label="キャプション"
              value={item.caption}
              onChange={(caption) => set(index, { caption })}
              max={300}
            />
            <Button
              kind="quiet"
              onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
            >
              外す
            </Button>
          </div>
        </div>
      ))}
      <div className="inline">
        <Button onClick={() => setPicking(true)}>写真を追加</Button>
        {dirty && (
          <Button kind="primary" busy={busy === "save"} onClick={() => void save()}>
            保存
          </Button>
        )}
      </div>
      {picking && (
        <MediaPicker
          onClose={() => setPicking(false)}
          onPick={(asset) => {
            setPicking(false);
            setItems((current) => [
              ...current,
              {
                mediaId: asset.id,
                url: asset.thumbnailUrl ?? asset.url,
                role: current.some((item) => item.role === "cover") ? "gallery" : "cover",
                alt: "",
                caption: "",
              },
            ]);
          }}
        />
      )}
    </Panel>
  );
}
