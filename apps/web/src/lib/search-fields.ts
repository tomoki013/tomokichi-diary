import type { ArticleView } from "@tomokichi/application";
import { normalizeSearch, searchWordsFor } from "./archive-search";
import { content } from "./content";

/**
 * What one article is found by, written once for both searches (the article
 * list and the header's search box) so they never disagree about a match.
 * `heading` is the title and the slug; `text` adds the summary, categories,
 * tags, series and journeys, and each place with its country, in Japanese and
 * as slugs ("france", "paris"), and the search-only words (readings and other
 * spellings kept in the admin) for anything the article mentions, body
 * included. The body itself is not searched: it would make the list heavy.
 */
export function searchFields(view: ArticleView): { heading: string; text: string } {
  const places = view.locations.flatMap(({ location }) => {
    const country = content.locations.countryOf(location.id);
    return [
      content.locations.nameOf(location.id, "ja"),
      location.slug,
      ...(country ? [content.locations.nameOf(country.id, "ja"), country.slug] : []),
    ];
  });
  const said = [
    view.revision.title,
    view.article.slug,
    view.revision.summary,
    ...view.categories.map((item) => item.name),
    ...view.tags.map((item) => item.name),
    ...content.collectionsOf(view.article.id).map((item) => item.title),
    ...new Set(places),
  ].join(" ");
  const aliases = searchWordsFor(
    `${said} ${view.revision.bodyMarkdown}`,
    content.snapshot.searchWords ?? [],
  );
  return {
    heading: normalizeSearch(`${view.revision.title} ${view.article.slug}`),
    text: `${normalizeSearch(said)} ${[...new Set(aliases)].join(" ")}`.trim(),
  };
}
