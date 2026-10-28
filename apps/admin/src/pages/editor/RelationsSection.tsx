import { useSectionSave, type RegisterSection } from "./section-save";
import { useMemo, useRef, useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { api, type PlaceDto, type Relation, type RelationsInput } from "../../lib/api";
import { experienceLabels, relationLabels } from "../../lib/labels";
import {
  addMissing,
  emptyDefaults,
  locationTagIds,
  removeAdded,
} from "../../lib/relation-defaults";
import { treeOrder } from "../../lib/locations";
import { useResource } from "../../ui/hooks";
import { href } from "../../lib/route";
import { ErrorState, Panel, SkeletonRows } from "../../ui/parts";
import { useToast } from "../../ui/toast";

function relationsFrom(article: ArticleDetailDto): RelationsInput {
  return {
    locations: article.relations.locations.map((item) => ({
      locationId: item.locationId,
      relation: item.relation as Relation,
    })),
    places: article.relations.places.map((item) => ({
      placeId: item.placeId,
      relation: item.relation as Relation,
    })),
    categoryIds: [...article.relations.categoryIds],
    tagIds: [...article.relations.tagIds],
    collectionIds: [...article.collectionIds],
  };
}

/** A series joined or left here, passed on to the experience tags. */
export interface ExperienceDefaultsChange {
  key: number;
  source: string;
  add: readonly string[];
  /** Take back what this source added, except these. */
  remove: boolean;
  keep: readonly string[];
}

/**
 * Relations drive related articles, location hubs and structured data, so
 * they are edited as data rather than guessed from the body text.
 *
 * A choice that decides others fills them in: joining a series adds its
 * default tags, categories and experience tags; choosing a place adds the
 * tags named after it and 国内旅行 / 海外旅行. Taking the choice back removes
 * what it added in this session, unless another choice still wants it.
 */
export function RelationsSection({
  article,
  onSaved,
  register,
  onSaveAll,
  onExperienceDefaults,
}: {
  article: ArticleDetailDto;
  onSaved: () => Promise<void>;
  register: RegisterSection;
  onSaveAll: () => Promise<boolean>;
  onExperienceDefaults?: (change: ExperienceDefaultsChange) => void;
}) {
  const toast = useToast();
  const reference = useResource(
    () =>
      Promise.all([api.taxonomy(), api.listLocations(), api.listPlaces()]).then(
        ([taxonomy, locations, places]) => ({
          taxonomy,
          locations: locations.items,
          places: places.items,
        }),
      ),
    "reference",
  );
  const [value, setValue] = useState<RelationsInput>(() => relationsFrom(article));
  const [baseline, setBaseline] = useState(() => JSON.stringify(relationsFrom(article)));
  const [tagFilter, setTagFilter] = useState("");
  const [newTag, setNewTag] = useState({ name: "", slug: "" });
  const [creatingTag, setCreatingTag] = useState(false);
  const [busy, setBusy] = useState(false);
  // What each choice made in this session added, so undoing it is exact.
  const added = useRef(new Map<string, { tagIds: string[]; categoryIds: string[] }>());
  const changeKey = useRef(0);
  const dirty = JSON.stringify(value) !== baseline;

  const tree = useMemo(() => treeOrder(reference.data?.locations ?? []), [reference.data]);
  const byId = useMemo(
    () => new Map((reference.data?.locations ?? []).map((location) => [location.id, location])),
    [reference.data],
  );
  const chosenLocations = new Set(value.locations.map((item) => item.locationId));
  const placesHere: PlaceDto[] = (reference.data?.places ?? []).filter(
    (place) => place.locationId !== null && chosenLocations.has(place.locationId),
  );

  const defaultsOf = (collectionId: string) =>
    reference.data?.taxonomy.collections.find((c) => c.id === collectionId)?.articleDefaults ??
    emptyDefaults;
  const tagsOfLocation = (locationId: string) =>
    reference.data
      ? locationTagIds(locationId, reference.data.locations, reference.data.taxonomy.tags)
      : [];
  /** What the choices other than `source` still bring, so leaving one keeps the rest. */
  const wantedExcept = (source: string, next: RelationsInput) => {
    const collections = next.collectionIds.filter((id) => `collection:${id}` !== source);
    const locations = next.locations
      .map((item) => item.locationId)
      .filter((id) => `location:${id}` !== source);
    return {
      tagIds: [
        ...collections.flatMap((id) => defaultsOf(id).tagIds),
        ...locations.flatMap(tagsOfLocation),
      ],
      categoryIds: collections.flatMap((id) => defaultsOf(id).categoryIds),
      experienceTags: collections.flatMap((id) => defaultsOf(id).experienceTags),
    };
  };

  /** Applies what a choice brings, or takes it back, on top of `next`. */
  const linked = (
    next: RelationsInput,
    source: string,
    on: boolean,
    wanted: { tagIds: readonly string[]; categoryIds: readonly string[] },
  ): { value: RelationsInput; tags: number; categories: number } => {
    if (on) {
      const tags = addMissing(next.tagIds, wanted.tagIds);
      const categories = addMissing(next.categoryIds, wanted.categoryIds);
      added.current.set(source, { tagIds: tags.added, categoryIds: categories.added });
      return {
        value: { ...next, tagIds: tags.next, categoryIds: categories.next },
        tags: tags.added.length,
        categories: categories.added.length,
      };
    }
    const before = added.current.get(source);
    added.current.delete(source);
    if (!before) return { value: next, tags: 0, categories: 0 };
    const keep = wantedExcept(source, next);
    const tagIds = removeAdded(next.tagIds, before.tagIds, keep.tagIds);
    const categoryIds = removeAdded(next.categoryIds, before.categoryIds, keep.categoryIds);
    return {
      value: { ...next, tagIds, categoryIds },
      tags: next.tagIds.length - tagIds.length,
      categories: next.categoryIds.length - categoryIds.length,
    };
  };

  function toggleCollection(collectionId: string, title: string): void {
    const on = !value.collectionIds.includes(collectionId);
    const source = `collection:${collectionId}`;
    const next = {
      ...value,
      collectionIds: on
        ? [...value.collectionIds, collectionId]
        : value.collectionIds.filter((id) => id !== collectionId),
    };
    const defaults = defaultsOf(collectionId);
    const result = linked(next, source, on, defaults);
    setValue(result.value);
    onExperienceDefaults?.({
      key: ++changeKey.current,
      source,
      add: on ? defaults.experienceTags : [],
      remove: !on,
      keep: on ? [] : wantedExcept(source, result.value).experienceTags,
    });
    const parts = [
      result.tags > 0 && `タグ${result.tags}件`,
      result.categories > 0 && `カテゴリー${result.categories}件`,
      on &&
        defaults.experienceTags.length > 0 &&
        `体験タグ「${defaults.experienceTags.map((tag) => experienceLabels[tag] ?? tag).join("・")}」`,
    ].filter(Boolean);
    if (parts.length > 0)
      toast.info(
        on
          ? `「${title}」の既定から${parts.join("・")}を追加しました`
          : `「${title}」で追加した${parts.join("・")}を外しました`,
      );
  }

  function addLocation(locationId: string): void {
    const next: RelationsInput = {
      ...value,
      locations: [
        ...value.locations,
        { locationId, relation: value.locations.length === 0 ? "primary" : "mentioned" },
      ],
    };
    const result = linked(next, `location:${locationId}`, true, {
      tagIds: tagsOfLocation(locationId),
      categoryIds: [],
    });
    setValue(result.value);
  }

  function removeLocation(index: number): void {
    const item = value.locations[index];
    if (!item) return;
    const next: RelationsInput = {
      ...value,
      locations: value.locations.filter((_, i) => i !== index),
      // Places hang off locations; drop the ones left without one.
      places: value.places.filter((place) => {
        const home = reference.data?.places.find((p) => p.id === place.placeId);
        return home?.locationId !== item.locationId;
      }),
    };
    setValue(linked(next, `location:${item.locationId}`, false, emptyDefaults).value);
  }

  const toggle = (key: "categoryIds" | "tagIds" | "collectionIds", id: string): void =>
    setValue((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((item) => item !== id)
        : [...current[key], id],
    }));

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      await api.saveRelations(article.id, value);
      setBaseline(JSON.stringify(value));
      toast.info("関連付けを保存しました");
      await onSaved();
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  useSectionSave(register, "relations", { dirty, busy, save });

  // A new tag is created right away (it is shared data, not part of this
  // article's draft) and ticked here, so it is saved with the relations.
  async function addTag(): Promise<void> {
    setCreatingTag(true);
    try {
      const tag = await api.createTag({ name: newTag.name.trim(), slug: newTag.slug.trim() });
      reference.setData((current) =>
        current
          ? { ...current, taxonomy: { ...current.taxonomy, tags: [...current.taxonomy.tags, tag] } }
          : current,
      );
      setValue((current) => ({ ...current, tagIds: [...current.tagIds, tag.id] }));
      setNewTag({ name: "", slug: "" });
      toast.info(`タグ「${tag.name}」を追加しました`);
    } catch (error) {
      toast.error(error);
    } finally {
      setCreatingTag(false);
    }
  }

  if (!reference.data) {
    return (
      <Panel title="関連付け">
        {reference.error ? (
          <ErrorState error={reference.error} onRetry={() => void reference.reload()} />
        ) : (
          <SkeletonRows rows={4} />
        )}
      </Panel>
    );
  }
  const { taxonomy } = reference.data;
  const tags = taxonomy.tags.filter(
    (tag) =>
      value.tagIds.includes(tag.id) ||
      tagFilter.trim() === "" ||
      tag.name.includes(tagFilter.trim()) ||
      tag.slug.includes(tagFilter.trim().toLowerCase()),
  );

  return (
    <Panel title="関連付け">
      <div className="field">
        <span className="field__label">地域（最初の1件が主になります）</span>
        <div className="tokens">
          {value.locations.map((item, index) => (
            <span key={item.locationId} className="token">
              {byId.get(item.locationId)?.name ?? item.locationId}
              <select
                aria-label="関係"
                value={item.relation}
                onChange={(event) =>
                  setValue((current) => ({
                    ...current,
                    locations: current.locations.map((entry, i) =>
                      i === index ? { ...entry, relation: event.target.value as Relation } : entry,
                    ),
                  }))
                }
              >
                {Object.entries(relationLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="外す" onClick={() => removeLocation(index)}>
                ×
              </button>
            </span>
          ))}
          <select
            aria-label="地域を追加"
            value=""
            onChange={(event) => {
              const locationId = event.target.value;
              if (!locationId || chosenLocations.has(locationId)) return;
              addLocation(locationId);
            }}
          >
            <option value="">＋ 地域を追加</option>
            {tree.map(({ location, depth }) => (
              <option
                key={location.id}
                value={location.id}
                disabled={chosenLocations.has(location.id)}
              >
                {"　".repeat(depth)}
                {location.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {placesHere.length > 0 && (
        <fieldset className="field">
          <legend className="field__label">スポット（選んだ地域のもの）</legend>
          <div className="checks">
            {placesHere.map((place) => {
              const chosen = value.places.some((item) => item.placeId === place.id);
              return (
                <label key={place.id} className="check">
                  <input
                    type="checkbox"
                    checked={chosen}
                    onChange={() =>
                      setValue((current) => ({
                        ...current,
                        places: chosen
                          ? current.places.filter((item) => item.placeId !== place.id)
                          : [...current.places, { placeId: place.id, relation: "visited" }],
                      }))
                    }
                  />
                  {place.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="field">
        <legend className="field__label">カテゴリー</legend>
        <div className="checks">
          {taxonomy.categories.map((category) => (
            <label key={category.id} className="check">
              <input
                type="checkbox"
                checked={value.categoryIds.includes(category.id)}
                onChange={() => toggle("categoryIds", category.id)}
              />
              {category.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">
          シリーズ・旅の記録 <a href={href.series()}>シリーズを管理</a>
        </legend>
        <p className="muted small">
          選ぶとシリーズの既定（タグ・カテゴリー・体験タグ）が入ります。地域を選ぶと、同じ名前のタグと国内旅行／海外旅行が入ります。
        </p>
        <div className="checks">
          {taxonomy.collections.map((collection) => (
            <label key={collection.id} className="check">
              <input
                type="checkbox"
                checked={value.collectionIds.includes(collection.id)}
                onChange={() => toggleCollection(collection.id, collection.title)}
              />
              {collection.title}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">
          タグ（{value.tagIds.length}）
          <input
            type="search"
            className="inline-search"
            aria-label="タグを検索"
            placeholder="絞り込み"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          />
        </legend>
        <div className="checks checks--scroll">
          {tags.map((tag) => (
            <label key={tag.id} className="check">
              <input
                type="checkbox"
                checked={value.tagIds.includes(tag.id)}
                onChange={() => toggle("tagIds", tag.id)}
              />
              {tag.name}
            </label>
          ))}
        </div>
        <div className="row">
          <input
            aria-label="新しいタグ名"
            placeholder="新しいタグ名（例：旅と音楽）"
            value={newTag.name}
            onChange={(event) => setNewTag((current) => ({ ...current, name: event.target.value }))}
          />
          <input
            aria-label="新しいタグのslug"
            placeholder="slug（例：travel-music）"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={newTag.slug}
            onChange={(event) =>
              setNewTag((current) => ({ ...current, slug: event.target.value.toLowerCase() }))
            }
          />
          <button
            type="button"
            disabled={creatingTag || newTag.name.trim() === "" || newTag.slug.trim() === ""}
            onClick={() => void addTag()}
          >
            ＋ タグを追加
          </button>
        </div>
      </fieldset>

      <div className="panel__foot">
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void onSaveAll()}
        >
          関連付けを保存
        </button>
      </div>
    </Panel>
  );
}
