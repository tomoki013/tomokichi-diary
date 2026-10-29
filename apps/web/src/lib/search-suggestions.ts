import { content } from "./content";

/**
 * Words a reader can tap instead of typing: the countries with the most
 * articles, then a few kinds of article the site has many of. Worked out from
 * the published content at build time, so the list follows what is written.
 */
export function searchSuggestions(limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const article of content.publicArticles()) {
    if (article.kind !== "article") continue;
    const country = content.countryOf(article.id);
    if (!country) continue;
    const name = content.locations.nameOf(country.id, "ja");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const countries = [...counts]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, limit - 2)
    .map(([name]) => name);
  return [...countries, "空港", "移動"];
}
