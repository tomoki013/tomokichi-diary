import { useMemo, useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp } from "../../data/hooks";
import { experienceLabels, relationLabels } from "../../lib/labels";
import { treeOrder } from "../../lib/locations";
import { addMissing, locationTagIds } from "../../lib/relation-defaults";
import { Button, Chips, Field, Panel, TextInput } from "../../ui/parts";
import { useToast } from "../../ui/toast";

type Relation = keyof typeof relationLabels;
interface Choice {
  collectionIds: string[];
  tagIds: string[];
  categoryIds: string[];
  locations: { locationId: string; relation: Relation }[];
  experienceTags: string[];
}
const fromArticle = (article: ArticleDetailDto): Choice => ({
  collectionIds: [...article.collectionIds],
  tagIds: [...article.relations.tagIds],
  categoryIds: [...article.relations.categoryIds],
  locations: article.relations.locations.map((l) => ({
    locationId: l.locationId,
    relation: l.relation as Relation,
  })),
  experienceTags: [...article.experienceTags],
});
const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * Where the piece is filed: series, tags, categories, places and how the
 * trip felt. Joining a series brings the tags that series asks for; choosing
 * a place brings the tags named after it.
 */
export function RelationsPanel({ article }: { article: ArticleDetailDto }) {
  const taxonomy = useOp("taxonomy.get");
  const locations = useOp("location.list");
  const [choice, setChoice] = useState(() => fromArticle(article));
  const [placeQuery, setPlaceQuery] = useState("");
  const { busy, run } = useAction();
  const toast = useToast();
  const original = fromArticle(article);
  const dirty = JSON.stringify(choice) !== JSON.stringify(original);
  const tree = useMemo(() => treeOrder(locations.data?.items ?? []), [locations.data]);
  const tags = taxonomy.data?.tags ?? [];

  function joinSeries(id: string) {
    const series = taxonomy.data?.collections.find((c) => c.id === id);
    setChoice((current) => {
      if (current.collectionIds.includes(id))
        return { ...current, collectionIds: current.collectionIds.filter((c) => c !== id) };
      const defaults = series?.articleDefaults;
      const next = { ...current, collectionIds: [...current.collectionIds, id] };
      if (!defaults) return next;
      const t = addMissing(next.tagIds, defaults.tagIds);
      const c = addMissing(next.categoryIds, defaults.categoryIds);
      const e = addMissing(next.experienceTags, defaults.experienceTags);
      const added = t.added.length + c.added.length + e.added.length;
      if (added > 0) toast.info(`シリーズの既定のタグなどを${added}件足しました`);
      return { ...next, tagIds: t.next, categoryIds: c.next, experienceTags: e.next };
    });
  }
  function addPlace(locationId: string) {
    setChoice((current) => {
      if (current.locations.some((l) => l.locationId === locationId)) return current;
      const wanted = locationTagIds(locationId, locations.data?.items ?? [], tags);
      return {
        ...current,
        locations: [
          ...current.locations,
          { locationId, relation: current.locations.length === 0 ? "primary" : "visited" },
        ],
        tagIds: addMissing(current.tagIds, wanted).next,
      };
    });
  }
  async function save() {
    const changedRelations =
      JSON.stringify({ ...choice, experienceTags: [] }) !==
      JSON.stringify({ ...original, experienceTags: [] });
    await run(
      "save",
      async () => {
        if (changedRelations)
          await op("article.setRelations", {
            articleId: article.id,
            ...(taxonomy.data
              ? {
                  collectionIds: choice.collectionIds.filter((id) =>
                    taxonomy.data?.collections.some((c) => c.id === id && c.kind === "series"),
                  ),
                }
              : {}),
            tagIds: choice.tagIds,
            categoryIds: choice.categoryIds,
            locations: choice.locations,
          });
        if (JSON.stringify(choice.experienceTags) !== JSON.stringify(original.experienceTags))
          await op("article.setExperienceTags", {
            articleId: article.id,
            experienceTags: choice.experienceTags,
          });
      },
      { done: "分類を保存しました", touches: ["article"] },
    );
  }
  const nameOf = (id: string) => tree.find((t) => t.location.id === id)?.location.name ?? id;
  const needle = placeQuery.trim();
  const candidates = needle
    ? tree
        .filter(
          (t) => t.location.name.includes(needle) || t.location.slug.includes(needle.toLowerCase()),
        )
        .slice(0, 12)
    : [];
  return (
    <Panel
      id="relations"
      title="分類"
      collapsible
      actions={
        dirty ? (
          <Button kind="primary" busy={busy === "save"} onClick={() => void save()}>
            保存
          </Button>
        ) : undefined
      }
    >
      <Field label="体験タグ">
        {() => (
          <Chips
            options={Object.entries(experienceLabels).map(([value, label]) => ({ value, label }))}
            selected={choice.experienceTags}
            onToggle={(value) =>
              setChoice((c) => ({ ...c, experienceTags: toggle(c.experienceTags, value) }))
            }
          />
        )}
      </Field>
      <Field label="シリーズ">
        {() => (
          <Chips
            options={(taxonomy.data?.collections ?? [])
              .filter((c) => c.kind === "series")
              .map((c) => ({
                value: c.id,
                label: c.title,
              }))}
            selected={choice.collectionIds}
            onToggle={joinSeries}
          />
        )}
      </Field>
      <Field label="カテゴリー">
        {() => (
          <Chips
            options={(taxonomy.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
            selected={choice.categoryIds}
            onToggle={(value) =>
              setChoice((c) => ({ ...c, categoryIds: toggle(c.categoryIds, value) }))
            }
          />
        )}
      </Field>
      <Field label="タグ">
        {() => (
          <Chips
            options={tags.map((t) => ({ value: t.id, label: t.name }))}
            selected={choice.tagIds}
            onToggle={(value) => setChoice((c) => ({ ...c, tagIds: toggle(c.tagIds, value) }))}
          />
        )}
      </Field>
      <Field label="地域">
        {() => (
          <div className="stack">
            {choice.locations.map((l) => (
              <div key={l.locationId} className="inline">
                <strong>{nameOf(l.locationId)}</strong>
                <Chips
                  options={Object.entries(relationLabels).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  selected={[l.relation]}
                  onToggle={(relation) =>
                    setChoice((c) => ({
                      ...c,
                      locations: c.locations.map((x) =>
                        x.locationId === l.locationId
                          ? { ...x, relation: relation as Relation }
                          : x,
                      ),
                    }))
                  }
                />
                <Button
                  kind="quiet"
                  onClick={() =>
                    setChoice((c) => ({
                      ...c,
                      locations: c.locations.filter((x) => x.locationId !== l.locationId),
                    }))
                  }
                >
                  外す
                </Button>
              </div>
            ))}
            <TextInput
              label="地域を探す"
              type="search"
              value={placeQuery}
              onChange={setPlaceQuery}
              placeholder="京都・ギリシャ など"
            />
            {candidates.length > 0 && (
              <Chips
                options={candidates.map((t) => ({ value: t.location.id, label: t.location.name }))}
                selected={[]}
                onToggle={(id) => {
                  addPlace(id);
                  setPlaceQuery("");
                }}
              />
            )}
          </div>
        )}
      </Field>
      {dirty && (
        <Button kind="primary" busy={busy === "save"} onClick={() => void save()}>
          分類を保存
        </Button>
      )}
    </Panel>
  );
}
