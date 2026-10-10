import type { AppContext } from "../../context.js";
import type { ContentSnapshot } from "@tomokichi/data";

export async function loadContentSnapshot(ctx: AppContext): Promise<ContentSnapshot> {
  const { repos } = ctx;
  const articles = await repos.articles.listAll();

  // Only revisions the site can render are pulled: drafts stay out of the
  // snapshot so an unpublished edit can never leak into a build.
  const revisionIds = articles.map((a) => a.publishedRevisionId).filter((id) => id !== null);
  const revisions = (
    await Promise.all(revisionIds.map((id) => repos.revisions.findById(id)))
  ).filter((revision) => revision !== null);
  const embeds = (
    await Promise.all(revisions.map((r) => repos.embeds.listByRevision(r.id)))
  ).flat();
  const articleMedia = (
    await Promise.all(articles.map((a) => repos.media.listForArticle(a.id)))
  ).flat();

  const snapshot: ContentSnapshot = {
    generatedAt: ctx.clock.now(),
    articles,
    revisions,
    embeds,
    routes: await repos.routes.listAll(),
    locations: await repos.locations.listAll(),
    locationNames: await repos.locations.listNames(),
    places: await repos.places.listAll(),
    categories: await repos.taxonomy.listCategories(),
    tags: await repos.taxonomy.listTags(),
    collections: await repos.collections.listAll(),
    authors: await repos.authors.listAll(),
    media: await repos.media.listAll(),
    articleMedia,
    articleLocations: await repos.relations.listArticleLocations(),
    articlePlaces: await repos.relations.listArticlePlaces(),
    articleCategories: await repos.relations.listArticleCategories(),
    articleTags: await repos.relations.listArticleTags(),
    articleCollections: await repos.collections.listMemberships(),
    aiArtifacts: [],
    sources: await repos.knowledge.listSources(),
    travelRoutes: await repos.knowledge.listTravelRoutes(),
    travelFacts: await repos.knowledge.listTravelFacts(),
    articleKnowledge: (await repos.knowledge.listArticleKnowledge()).filter((knowledge) =>
      revisionIds.includes(knowledge.revisionId),
    ),
  };
  const published = new Map(
    (await repos.publicationMetadata.listAll()).map((entry) => [entry.revisionId, entry.metadata]),
  );
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
