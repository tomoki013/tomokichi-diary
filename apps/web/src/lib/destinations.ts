import { content } from "./content";

/**
 * Visited countries grouped by continent, with the cities that have their own
 * page. Continents group the list rather than having pages of their own: they
 * sat at the same URL depth as the countries they contain.
 */
export function visitedContinents() {
  const articles = content.articleViews();
  return content.locations
    .roots()
    .map((root) => ({
      name: content.locations.nameOf(root.id, "ja"),
      countries: content.locations.children(root.id).flatMap((country) => {
        const hub = content.routes.canonicalFor("location", country.id);
        const countryArticles = articles.filter((view) =>
          content.relations.locations.some(
            (relation) =>
              relation.articleId === view.article.id &&
              content.locations.countryOf(relation.locationId)?.id === country.id,
          ),
        );
        return hub
          ? [
              {
                id: country.id,
                slug: country.slug,
                name: content.locations.nameOf(country.id, "ja"),
                path: hub.path,
                count: countryArticles.length,
                cover: countryArticles.find((view) => view.cover)?.cover ?? null,
                cities: content.locations
                  .descendants(country.id)
                  .filter((place) => place.type === "city")
                  .flatMap((place) => {
                    const cityRoute = content.routes.canonicalFor("location", place.id);
                    return cityRoute
                      ? [
                          {
                            id: place.id,
                            slug: place.slug,
                            name: content.locations.nameOf(place.id, "ja"),
                            path: cityRoute.path,
                          },
                        ]
                      : [];
                  }),
              },
            ]
          : [];
      }),
    }))
    .filter((continent) => continent.countries.length > 0);
}

export type VisitedContinent = ReturnType<typeof visitedContinents>[number];
export type VisitedCountry = VisitedContinent["countries"][number];

/** One trip each, newest first: what the home map calls "footprints". */
export function journeys() {
  return content.snapshot.collections
    .filter((collection) => collection.kind === "journey")
    .flatMap((collection) => {
      const hub = content.routes.canonicalFor("journey", collection.id);
      const members = content.membersOf(collection.id);
      return hub && members.length > 0
        ? [{ collection, path: hub.path, count: members.length }]
        : [];
    })
    .toSorted((a, b) => (b.collection.startDate ?? "").localeCompare(a.collection.startDate ?? ""));
}
