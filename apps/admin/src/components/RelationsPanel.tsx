import { useState } from "react";
import type { ArticleDetailDto, LocationDto, TaxonomyDto } from "@tomokichi/contracts";
import type { RelationsInput } from "../api";

/**
 * Relations are what make related articles, location hubs and structured data
 * work, so they are edited as first-class data rather than guessed from the
 * body text (instruction §22, §81).
 */
export function RelationsPanel({
  article,
  taxonomy,
  locations,
  busy,
  onSave,
}: {
  article: ArticleDetailDto;
  taxonomy: TaxonomyDto | null;
  locations: LocationDto[];
  busy: boolean;
  onSave: (relations: RelationsInput) => void;
}) {
  const [value, setValue] = useState<RelationsInput>({
    locations: article.relations.locations.map((item) => ({
      locationId: item.locationId,
      relation: item.relation as RelationsInput["locations"][number]["relation"],
    })),
    places: article.relations.places.map((item) => ({
      placeId: item.placeId,
      relation: item.relation as RelationsInput["places"][number]["relation"],
    })),
    categoryIds: [...article.relations.categoryIds],
    tagIds: [...article.relations.tagIds],
    collectionIds: [...article.collectionIds],
  });

  const toggle = (key: "categoryIds" | "tagIds" | "collectionIds", id: string): void =>
    setValue({
      ...value,
      [key]: value[key].includes(id)
        ? value[key].filter((item) => item !== id)
        : [...value[key], id],
    });

  const nameOf = (id: string): string =>
    locations.find((location) => location.id === id)?.name ?? id;

  return (
    <div className="panel">
      <h2>関連付け</h2>

      <label>
        <span>地域（最初の1件が primary になります）</span>
        <select
          value=""
          onChange={(event) => {
            const locationId = event.target.value;
            if (locationId === "" || value.locations.some((item) => item.locationId === locationId))
              return;
            setValue({
              ...value,
              locations: [
                ...value.locations,
                { locationId, relation: value.locations.length === 0 ? "primary" : "mentioned" },
              ],
            });
          }}
        >
          <option value="">地域を追加…</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {"　".repeat(location.type === "city" ? 2 : location.type === "country" ? 1 : 0)}
              {location.name}
            </option>
          ))}
        </select>
      </label>

      <div className="checks" style={{ marginBottom: "1rem" }}>
        {value.locations.map((item, index) => (
          <label key={item.locationId}>
            {nameOf(item.locationId)}
            <select
              value={item.relation}
              onChange={(event) =>
                setValue({
                  ...value,
                  locations: value.locations.map((entry, i) =>
                    i === index
                      ? {
                          ...entry,
                          relation: event.target
                            .value as RelationsInput["locations"][number]["relation"],
                        }
                      : entry,
                  ),
                })
              }
              style={{ width: "auto" }}
            >
              <option value="primary">primary</option>
              <option value="visited">visited</option>
              <option value="mentioned">mentioned</option>
              <option value="related">related</option>
            </select>
            <button
              className="danger"
              onClick={() =>
                setValue({ ...value, locations: value.locations.filter((_, i) => i !== index) })
              }
            >
              ×
            </button>
          </label>
        ))}
      </div>

      {taxonomy && (
        <>
          <p className="muted">カテゴリー</p>
          <div className="checks" style={{ marginBottom: "1rem" }}>
            {taxonomy.categories.map((category) => (
              <label key={category.id}>
                <input
                  type="checkbox"
                  checked={value.categoryIds.includes(category.id)}
                  onChange={() => toggle("categoryIds", category.id)}
                />
                {category.name}
              </label>
            ))}
          </div>

          <p className="muted">シリーズ・旅の記録</p>
          <div className="checks" style={{ marginBottom: "1rem" }}>
            {taxonomy.collections.map((collection) => (
              <label key={collection.id}>
                <input
                  type="checkbox"
                  checked={value.collectionIds.includes(collection.id)}
                  onChange={() => toggle("collectionIds", collection.id)}
                />
                {collection.title}
              </label>
            ))}
          </div>

          <p className="muted">タグ</p>
          <div className="checks" style={{ marginBottom: "1rem" }}>
            {taxonomy.tags.map((tag) => (
              <label key={tag.id}>
                <input
                  type="checkbox"
                  checked={value.tagIds.includes(tag.id)}
                  onChange={() => toggle("tagIds", tag.id)}
                />
                {tag.name}
              </label>
            ))}
          </div>
        </>
      )}

      <button disabled={busy} onClick={() => onSave(value)}>
        関連付けを保存
      </button>
    </div>
  );
}
