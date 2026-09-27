import { useMemo, useState } from "react";
import type { ArticleDetailDto } from "@tomokichi/contracts";
import { api, type PlaceDto, type Relation, type RelationsInput } from "../../lib/api";
import { relationLabels } from "../../lib/labels";
import { treeOrder } from "../../lib/locations";
import { useResource } from "../../ui/hooks";
import { Panel, SkeletonRows } from "../../ui/parts";
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

/**
 * Relations drive related articles, location hubs and structured data, so
 * they are edited as data rather than guessed from the body text.
 */
export function RelationsSection({
  article,
  onSaved,
}: {
  article: ArticleDetailDto;
  onSaved: () => Promise<void>;
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
  const [busy, setBusy] = useState(false);
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

  const toggle = (key: "categoryIds" | "tagIds" | "collectionIds", id: string): void =>
    setValue((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((item) => item !== id)
        : [...current[key], id],
    }));

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api.saveRelations(article.id, value);
      setBaseline(JSON.stringify(value));
      toast.info("関連付けを保存しました");
      await onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  if (!reference.data) {
    return (
      <Panel title="関連付け">
        <SkeletonRows rows={4} />
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
              <button
                type="button"
                aria-label="外す"
                onClick={() =>
                  setValue((current) => ({
                    ...current,
                    locations: current.locations.filter((_, i) => i !== index),
                    // Places hang off locations; drop the ones left without one.
                    places: current.places.filter((place) => {
                      const home = reference.data?.places.find((p) => p.id === place.placeId);
                      return home?.locationId !== item.locationId;
                    }),
                  }))
                }
              >
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
              setValue((current) => ({
                ...current,
                locations: [
                  ...current.locations,
                  {
                    locationId,
                    relation: current.locations.length === 0 ? "primary" : "mentioned",
                  },
                ],
              }));
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
        <legend className="field__label">シリーズ・旅の記録</legend>
        <div className="checks">
          {taxonomy.collections.map((collection) => (
            <label key={collection.id} className="check">
              <input
                type="checkbox"
                checked={value.collectionIds.includes(collection.id)}
                onChange={() => toggle("collectionIds", collection.id)}
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
      </fieldset>

      <div className="panel__foot">
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          関連付けを保存
        </button>
      </div>
    </Panel>
  );
}
