import { useState } from "react";
import type { CollectionAdminDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { go, href } from "../../app/router";
import { experienceLabels } from "../../lib/labels";
import { MediaPicker } from "../../ui/MediaPicker";
import {
  Badge,
  Button,
  Check,
  Chips,
  Field,
  Loaded,
  Page,
  Panel,
  Row,
  Rows,
  Select,
  TextArea,
  TextInput,
} from "../../ui/parts";

/** Series and journeys, and the tags that file articles. */
export function SeriesList() {
  useTitle("シリーズ");
  const list = useOp("series.list", {});
  const taxonomy = useOp("taxonomy.get");
  const [kind, setKind] = useState<"series" | "journey">("series");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [tagSlug, setTagSlug] = useState("");
  const [tagName, setTagName] = useState("");
  const { busy, run } = useAction();
  return (
    <Page title="シリーズ・タグ" back={{ href: href.more(), label: "その他" }}>
      <Loaded resource={list} lines={6}>
        {(data) => (
          <Rows>
            {data.items.map((item) => (
              <Row
                key={item.id}
                href={href.seriesEdit(item.id)}
                title={item.title}
                meta={`${item.kind === "journey" ? "旅程" : "シリーズ"} · ${item.path ?? item.slug}`}
                aside={
                  <Badge tone={item.publishedCount > 0 ? "ok" : "neutral"}>
                    公開 {item.publishedCount}
                  </Badge>
                }
              />
            ))}
          </Rows>
        )}
      </Loaded>
      <Panel title="シリーズを作る" collapsible>
        <Select
          label="種類"
          value={kind}
          options={[
            { value: "series", label: "シリーズ" },
            { value: "journey", label: "旅程" },
          ]}
          onChange={setKind}
        />
        <TextInput label="名前" value={title} onChange={setTitle} max={80} />
        <TextInput
          label="slug"
          value={slug}
          onChange={setSlug}
          hint="URL /collections/<slug> になり、あとから変えられません"
        />
        <Button
          kind="primary"
          busy={busy === "series"}
          disabled={!title || !slug}
          onClick={async () => {
            const created = await run(
              "series",
              () =>
                op("series.create", {
                  kind,
                  slug,
                  title,
                  description: null,
                  coverMediaId: null,
                  sortOrder: null,
                }),
              { touches: ["series", "taxonomy"] },
            );
            if (created) go(href.seriesEdit(created.id));
          }}
        >
          作る
        </Button>
      </Panel>
      <Panel title="タグ" hint={`${taxonomy.data?.tags.length ?? 0}件`} collapsible>
        <Chips
          options={(taxonomy.data?.tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
          selected={[]}
          onToggle={() => undefined}
        />
        <div className="inline">
          <TextInput label="新しいタグ" value={tagName} onChange={setTagName} max={80} />
          <TextInput label="slug" value={tagSlug} onChange={setTagSlug} />
        </div>
        <Button
          busy={busy === "tag"}
          disabled={!tagName || !tagSlug}
          onClick={async () => {
            const done = await run(
              "tag",
              () => op("tag.create", { slug: tagSlug, name: tagName }),
              {
                done: "タグを作りました",
                touches: ["taxonomy"],
              },
            );
            if (done) {
              setTagName("");
              setTagSlug("");
            }
          }}
        >
          タグを作る
        </Button>
      </Panel>
    </Page>
  );
}

export function SeriesEdit({ id }: { id: string }) {
  const series = useOp("series.get", { collectionId: id });
  return (
    <Loaded resource={series}>
      {(data) => <SeriesForm key={data.updatedAt ?? data.id} series={data} />}
    </Loaded>
  );
}

const toggle = (list: readonly string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function SeriesForm({ series }: { series: CollectionAdminDto }) {
  useTitle(series.title);
  const taxonomy = useOp("taxonomy.get");
  const [title, setTitle] = useState(series.title);
  const [description, setDescription] = useState(series.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(series.sortOrder));
  const [cover, setCover] = useState<{ id: string | null; url: string | null }>({
    id: series.coverMediaId,
    url: series.coverUrl,
  });
  const [music, setMusic] = useState(series.themeMusic?.url ?? "");
  const [musicTitle, setMusicTitle] = useState(series.themeMusic?.title ?? "");
  const [musicOn, setMusicOn] = useState(series.themeMusic?.enabled ?? false);
  const [defaults, setDefaults] = useState(series.articleDefaults);
  const [picking, setPicking] = useState(false);
  const { busy, run } = useAction();
  const save = () =>
    run(
      "save",
      () =>
        op("series.update", {
          collectionId: series.id,
          title,
          description: description.trim() || null,
          coverMediaId: cover.id,
          sortOrder: Number(sortOrder) || 0,
          themeMusic: music.trim()
            ? {
                provider: "apple_music",
                url: music.trim(),
                title: musicTitle.trim() || null,
                enabled: musicOn,
              }
            : null,
          articleDefaults: {
            tagIds: [...defaults.tagIds],
            categoryIds: [...defaults.categoryIds],
            experienceTags: [...defaults.experienceTags],
          },
        }),
      { done: "保存しました。サイトへは次の反映で出ます", touches: ["series", "taxonomy"] },
    );
  return (
    <Page title={series.title} back={{ href: href.series(), label: "シリーズ" }}>
      <p className="muted">
        {series.path ?? series.slug} · 公開中の記事 {series.publishedCount}/{series.memberCount}
        {series.publishedCount === 0 ? "（0本のあいだは検索に出ません）" : ""}
      </p>
      <Panel title="基本">
        <TextInput label="名前" value={title} onChange={setTitle} max={80} />
        <TextArea label="説明" value={description} onChange={setDescription} max={400} rows={3} />
        <TextInput label="表示順" type="number" value={sortOrder} onChange={setSortOrder} />
        <div className="inline">
          {cover.url && (
            <img
              src={cover.url}
              alt=""
              width={96}
              height={64}
              style={{ objectFit: "cover", borderRadius: 6 }}
            />
          )}
          <Button onClick={() => setPicking(true)}>
            {cover.id ? "カバーを変える" : "カバーを選ぶ"}
          </Button>
          {cover.id && (
            <Button kind="quiet" onClick={() => setCover({ id: null, url: null })}>
              外す
            </Button>
          )}
        </div>
      </Panel>
      <Panel title="テーマ曲" collapsible>
        <TextInput label="Apple Music の共有 URL" type="url" value={music} onChange={setMusic} />
        <TextInput label="曲名（任意）" value={musicTitle} onChange={setMusicTitle} />
        <Check label="ページで流せるようにする" checked={musicOn} onChange={setMusicOn} />
      </Panel>
      <Panel title="記事に付ける既定" hint="記事をこのシリーズに入れたとき一緒に付く" collapsible>
        {series.suggestedDefaults.tagIds.length + series.suggestedDefaults.experienceTags.length >
          0 && (
          <Button kind="quiet" onClick={() => setDefaults(series.suggestedDefaults)}>
            いまの記事から提案を使う
          </Button>
        )}
        <Field label="体験タグ">
          {() => (
            <Chips
              options={Object.entries(experienceLabels).map(([value, label]) => ({ value, label }))}
              selected={defaults.experienceTags}
              onToggle={(v) =>
                setDefaults((d) => ({ ...d, experienceTags: toggle(d.experienceTags, v) }))
              }
            />
          )}
        </Field>
        <Field label="カテゴリー">
          {() => (
            <Chips
              options={(taxonomy.data?.categories ?? []).map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              selected={defaults.categoryIds}
              onToggle={(v) =>
                setDefaults((d) => ({ ...d, categoryIds: toggle(d.categoryIds, v) }))
              }
            />
          )}
        </Field>
        <Field label="タグ">
          {() => (
            <Chips
              options={(taxonomy.data?.tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
              selected={defaults.tagIds}
              onToggle={(v) => setDefaults((d) => ({ ...d, tagIds: toggle(d.tagIds, v) }))}
            />
          )}
        </Field>
      </Panel>
      <Button kind="primary" busy={busy === "save"} onClick={() => void save()}>
        保存
      </Button>
      {picking && (
        <MediaPicker
          title="カバー写真"
          onClose={() => setPicking(false)}
          onPick={(asset) => {
            setCover({ id: asset.id, url: asset.thumbnailUrl ?? asset.url });
            setPicking(false);
          }}
        />
      )}
    </Page>
  );
}
