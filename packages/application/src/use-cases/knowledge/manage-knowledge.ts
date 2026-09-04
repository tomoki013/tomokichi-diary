import {
  validateKnowledgeGraph,
  type ArticleId,
  type ArticleKnowledge,
  type SourceReference,
  type TravelFact,
  type TravelRoute,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

export interface EditableKnowledgeBundle {
  readonly article: ArticleKnowledge | null;
  readonly facts: readonly TravelFact[];
  readonly sources: readonly SourceReference[];
  readonly routes: readonly TravelRoute[];
  readonly canSuggestWithAi: boolean;
}

const mergeById = <T extends { readonly id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
) => {
  const ids = new Set(incoming.map((entry) => entry.id));
  return [...existing.filter((entry) => !ids.has(entry.id)), ...incoming];
};

export async function getEditableKnowledge(
  ctx: AppContext,
  articleId: ArticleId,
): Promise<EditableKnowledgeBundle> {
  const [article, allKnowledge, allFacts, sources, routes] = await Promise.all([
    ctx.repos.articles.findById(articleId),
    ctx.repos.knowledge.listArticleKnowledge(),
    ctx.repos.knowledge.listTravelFacts(),
    ctx.repos.knowledge.listSources(),
    ctx.repos.knowledge.listTravelRoutes(),
  ]);
  if (!article) throw new Error(`article not found: ${articleId}`);
  const knowledge =
    allKnowledge.find(
      (entry) => entry.articleId === articleId && entry.revisionId === article.currentRevisionId,
    ) ?? null;
  const facts = allFacts.filter((fact) => fact.articleIds.includes(articleId));
  const sourceIds = new Set(facts.flatMap((fact) => fact.sourceIds));
  const routeIds = new Set([
    ...(knowledge?.routeIds ?? []),
    ...facts.flatMap((fact) => fact.travelRouteId ?? []),
  ]);
  return {
    article: knowledge,
    facts,
    sources: sources.filter((source) => sourceIds.has(source.id)),
    routes: routes.filter((route) => routeIds.has(route.id)),
    canSuggestWithAi: ctx.ai !== null,
  };
}

/** Saves one article's knowledge atomically at the use-case boundary after full-graph validation. */
export async function saveEditableKnowledge(
  ctx: AppContext,
  articleId: ArticleId,
  input: Omit<EditableKnowledgeBundle, "canSuggestWithAi">,
): Promise<EditableKnowledgeBundle> {
  const [
    articles,
    revisions,
    places,
    existingSources,
    existingRoutes,
    existingFacts,
    existingKnowledge,
  ] = await Promise.all([
    ctx.repos.articles.listAll(),
    ctx.repos.revisions.listByArticle(articleId),
    ctx.repos.places.listAll(),
    ctx.repos.knowledge.listSources(),
    ctx.repos.knowledge.listTravelRoutes(),
    ctx.repos.knowledge.listTravelFacts(),
    ctx.repos.knowledge.listArticleKnowledge(),
  ]);
  const article = articles.find((entry) => entry.id === articleId);
  if (!article) throw new Error(`article not found: ${articleId}`);
  if (input.article && input.article.articleId !== articleId)
    throw new Error("article knowledge cannot be moved to another article");
  if (input.article && input.article.revisionId !== article.currentRevisionId)
    throw new Error("article knowledge must target the current revision");
  for (const fact of input.facts) {
    if (!fact.articleIds.includes(articleId))
      throw new Error(`fact ${fact.id} must reference this article`);
    if (fact.status === "verified" && fact.provenance === "firsthand") {
      const existing = existingFacts.find((entry) => entry.id === fact.id);
      if (!existing || existing.status !== "verified")
        throw new Error(`firsthand fact ${fact.id} must be verified with the review action`);
    }
  }

  const knowledge = input.article
    ? [
        ...existingKnowledge.filter(
          (entry) =>
            !(entry.articleId === articleId && entry.revisionId === input.article!.revisionId),
        ),
        input.article,
      ]
    : existingKnowledge;
  const graph = {
    sources: mergeById(existingSources, input.sources),
    travelRoutes: mergeById(existingRoutes, input.routes),
    travelFacts: mergeById(existingFacts, input.facts),
    articleKnowledge: knowledge,
  };
  const issues = validateKnowledgeGraph({
    ...graph,
    articleIds: new Set(articles.map((entry) => entry.id)),
    revisionIds: new Set(
      revisions.map((entry) => entry.id).concat(existingKnowledge.map((entry) => entry.revisionId)),
    ),
    placeIds: new Set(places.map((entry) => entry.id)),
    today: ctx.clock.now().slice(0, 10),
  });
  if (issues.length > 0)
    throw new Error(issues.map((issue) => `${issue.target}: ${issue.message}`).join("; "));

  await Promise.all(input.sources.map((source) => ctx.repos.knowledge.saveSource(source)));
  await Promise.all(input.routes.map((route) => ctx.repos.knowledge.saveTravelRoute(route)));
  await Promise.all(input.facts.map((fact) => ctx.repos.knowledge.saveTravelFact(fact)));
  if (input.article) await ctx.repos.knowledge.saveArticleKnowledge(input.article);
  await ctx.analytics?.track({ name: "knowledge_saved", articleId, factCount: input.facts.length });
  return getEditableKnowledge(ctx, articleId);
}
