import { publicMonetizationOnly } from "@tomokichi/data";
import type { AppContext } from "../../context.js";
import type { ContentSnapshot } from "@tomokichi/data";
import { canonicalImageLinks } from "./media-links.js";

export async function loadContentSnapshot(ctx: AppContext): Promise<ContentSnapshot> {
  const { repos } = ctx;
  // Every read goes out at once and none depends on another's result, so a
  // remote database answers the whole snapshot in a single batch rather than
  // one round trip per article. The per-article lists are regrouped below in
  // the order the per-article queries used to return them.
  const articles = await repos.articles.listAll();
  // Only revisions the site can render are pulled: drafts stay out of the
  // snapshot so an unpublished edit can never leak into a build.
  const revisionIds = articles.map((a) => a.publishedRevisionId).filter((id) => id !== null);
  const [
    revisionList,
    embedList,
    media,
    mediaSlugAliases,
    mediaHashes,
    usages,
    routes,
    locations,
    locationNames,
    places,
    categories,
    tags,
    collections,
    authors,
    articleLocations,
    articlePlaces,
    articleCategories,
    articleTags,
    articleCollections,
    sources,
    travelRoutes,
    travelFacts,
    articleKnowledge,
    publicationMetadata,
  ] = await Promise.all([
    repos.revisions.listByIds(revisionIds),
    repos.embeds.listByRevisions(revisionIds),
    repos.media.listAll(),
    repos.media.listSlugAliases(),
    repos.media.listHashes(),
    repos.media.listAllUsages(),
    repos.routes.listAll(),
    repos.locations.listAll(),
    repos.locations.listNames(),
    repos.places.listAll(),
    repos.taxonomy.listCategories(),
    repos.taxonomy.listTags(),
    repos.collections.listAll(),
    repos.authors.listAll(),
    repos.relations.listArticleLocations(),
    repos.relations.listArticlePlaces(),
    repos.relations.listArticleCategories(),
    repos.relations.listArticleTags(),
    repos.collections.listMemberships(),
    repos.knowledge.listSources(),
    repos.knowledge.listTravelRoutes(),
    repos.knowledge.listTravelFacts(),
    repos.knowledge.listArticleKnowledge(),
    repos.publicationMetadata.listAll(),
  ]);
  const revisionById = new Map(revisionList.map((revision) => [revision.id, revision]));
  const revisions = revisionIds.flatMap((id) => revisionById.get(id) ?? []);
  const embeds = revisions.flatMap((revision) =>
    embedList.filter((embed) => embed.revisionId === revision.id),
  );
  const usagesByArticle = new Map<string, (typeof usages)[number][]>();
  for (const usage of usages)
    usagesByArticle.set(usage.articleId, [...(usagesByArticle.get(usage.articleId) ?? []), usage]);
  const articleMedia = articles.flatMap((article) => usagesByArticle.get(article.id) ?? []);

  const snapshot: ContentSnapshot = {
    generatedAt: ctx.clock.now(),
    articles,
    // Revisions are never mutated in D1; only what the build reads is rewritten.
    revisions: revisions.map((revision) => ({
      ...revision,
      bodyMarkdown: canonicalImageLinks(revision.bodyMarkdown, media, mediaSlugAliases),
    })),
    embeds,
    routes,
    locations,
    locationNames,
    places,
    categories,
    tags,
    // A series' music reaches the build only while it is switched on; a
    // URL kept for later stays in the database.
    collections: collections.map((collection) => ({
      ...collection,
      themeMusic: collection.themeMusic?.enabled ? collection.themeMusic : null,
    })),
    authors,
    media,
    mediaSlugAliases,
    mediaHashes,
    articleMedia,
    articleLocations,
    articlePlaces,
    articleCategories,
    articleTags,
    articleCollections,
    aiArtifacts: [],
    sources,
    travelRoutes,
    travelFacts,
    articleKnowledge: articleKnowledge.filter((knowledge) =>
      revisionIds.includes(knowledge.revisionId),
    ),
  };
  const published = new Map(publicationMetadata.map((entry) => [entry.revisionId, entry.metadata]));
  const metadataByArticle = new Map(
    articles.flatMap((article) => {
      const metadata = article.publishedRevisionId
        ? published.get(article.publishedRevisionId)
        : null;
      return metadata ? [[article.id, metadata] as const] : [];
    }),
  );
  const frozen = new Set(metadataByArticle.keys());
  const replace = <T extends { articleId: string }>(
    current: readonly T[],
    saved: (m: import("../../ports/repositories.js").PublishedArticleMetadata) => readonly T[],
  ): readonly T[] => [
    ...current.filter((row) => !frozen.has(row.articleId as import("@tomokichi/domain").ArticleId)),
    ...[...metadataByArticle.values()].flatMap((m) => saved(m)),
  ];
  return {
    ...snapshot,
    monetization: publicMonetizationOnly(
      [...metadataByArticle.values()].flatMap((m) => (m.monetization ? [m.monetization] : [])),
    ),
    articles: articles.map((a) => ({
      ...a,
      experienceTags: metadataByArticle.get(a.id)?.experienceTags ?? a.experienceTags,
    })),
    articleMedia: replace(snapshot.articleMedia, (m) => m.media),
    articleLocations: replace(snapshot.articleLocations, (m) => m.locations),
    articlePlaces: replace(snapshot.articlePlaces, (m) => m.places),
    articleCategories: replace(snapshot.articleCategories, (m) => m.categories),
    articleTags: replace(snapshot.articleTags, (m) => m.tags),
    articleCollections: replace(snapshot.articleCollections, (m) => m.collections),
  };
}
