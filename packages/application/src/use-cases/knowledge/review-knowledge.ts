import {
  isPubliclyVisible,
  validateKnowledgeGraph,
  verifyFirsthandFact,
  type Article,
  type ArticleId,
  type AuthorId,
  type PlainDate,
  type Provenance,
  type TravelFact,
  type TravelFactId,
  type TravelFactKind,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

/**
 * How a fact gets from prose into the knowledge graph:
 *
 * 1. Anyone — the owner in the admin, or an AI client over the Operator MCP —
 *    proposes it. It is stored as a candidate and nothing public shows it.
 * 2. The owner, signed in to the admin, verifies or rejects it. No other
 *    caller can: the review action is not exposed to the MCP servers
 *    (ADR 0004 / 0009 / 0011).
 * 3. Only verified facts reach the site, structured data and the public MCP.
 */

export interface ProposedFact {
  readonly statement: string;
  readonly kind: TravelFactKind;
  readonly provenance: Provenance;
  readonly experiencedAt: string | null;
}

async function graph(ctx: AppContext) {
  const [sources, travelRoutes, travelFacts, articleKnowledge, articles, places] =
    await Promise.all([
      ctx.repos.knowledge.listSources(),
      ctx.repos.knowledge.listTravelRoutes(),
      ctx.repos.knowledge.listTravelFacts(),
      ctx.repos.knowledge.listArticleKnowledge(),
      ctx.repos.articles.listAll(),
      ctx.repos.places.listAll(),
    ]);
  return { sources, travelRoutes, travelFacts, articleKnowledge, articles, places };
}

/** Problems the graph would have with `facts` in place of what is stored, for those facts only. */
async function problemsWith(ctx: AppContext, facts: readonly TravelFact[]): Promise<string[]> {
  const current = await graph(ctx);
  const ids = new Set(facts.map((fact) => fact.id as string));
  const revisions = await ctx.repos.revisions.listByArticles(
    current.articles.map((article) => article.id),
  );
  return validateKnowledgeGraph({
    sources: current.sources,
    travelRoutes: current.travelRoutes,
    travelFacts: [...current.travelFacts.filter((fact) => !ids.has(fact.id)), ...facts],
    articleKnowledge: current.articleKnowledge,
    articleIds: new Set(current.articles.map((article) => article.id)),
    revisionIds: new Set(revisions.map((revision) => revision.id)),
    placeIds: new Set(current.places.map((place) => place.id)),
    today: ctx.clock.now().slice(0, 10),
  })
    .filter((issue) => ids.has(issue.target))
    .map((issue) => issue.message);
}

/**
 * Stores facts read from an article as candidates. A firsthand fact needs the
 * day it happened; when the caller does not know it, the article's own travel
 * date stands in.
 */
export async function proposeTravelFacts(
  ctx: AppContext,
  articleId: ArticleId,
  proposed: readonly ProposedFact[],
): Promise<readonly TravelFact[]> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article) throw new Error(`article not found: ${articleId}`);
  const facts = proposed.map((item): TravelFact => {
    const experiencedAt = (item.experiencedAt ??
      (item.provenance === "firsthand" ? article.travelStartDate : null)) as PlainDate | null;
    if (item.provenance === "firsthand" && experiencedAt === null)
      throw new Error(
        `一次体験の事実には体験した日（experiencedAt）が必要です: ${item.statement.slice(0, 40)}`,
      );
    return {
      id: ctx.ids.next<TravelFactId>(),
      kind: item.kind,
      statement: item.statement.trim(),
      provenance: item.provenance,
      status: "candidate",
      experiencedAt,
      verifiedAt: null,
      value: null,
      volatility: null,
      articleIds: [articleId],
      placeIds: [],
      sourceIds: [],
      travelRouteId: null,
      verifiedBy: null,
    };
  });
  const problems = await problemsWith(ctx, facts);
  if (problems.length > 0) throw new Error(problems.join("; "));
  await Promise.all(facts.map((fact) => ctx.repos.knowledge.saveTravelFact(fact)));
  await ctx.analytics?.track({ name: "knowledge_saved", articleId, factCount: facts.length });
  return facts;
}

async function candidate(ctx: AppContext, factId: TravelFactId): Promise<TravelFact> {
  const fact = (await ctx.repos.knowledge.listTravelFacts()).find((item) => item.id === factId);
  if (!fact) throw new Error(`travel fact not found: ${factId}`);
  if (fact.status !== "candidate") throw new Error("確認待ちの事実ではありません");
  return fact;
}

/** The owner confirms a candidate. `authorizedBy` is the human who did. */
export async function verifyFactCandidate(
  ctx: AppContext,
  factId: TravelFactId,
  authorizedBy: AuthorId,
): Promise<TravelFact> {
  const fact = await candidate(ctx, factId);
  const today = ctx.clock.now().slice(0, 10) as PlainDate;
  const verified: TravelFact =
    fact.provenance === "firsthand"
      ? verifyFirsthandFact(fact, { kind: "human", authorId: authorizedBy }, today)
      : { ...fact, status: "verified", verifiedAt: today, verifiedBy: authorizedBy };
  const problems = await problemsWith(ctx, [verified]);
  if (problems.length > 0) throw new Error(problems.join("; "));
  await ctx.repos.knowledge.saveTravelFact(verified);
  await ctx.analytics?.track({
    name: "firsthand_fact_verified",
    factId,
    articleId: fact.articleIds[0] ?? "",
  });
  return verified;
}

/** The owner turns a candidate down: it is removed, with every reference to it. */
export async function rejectFactCandidate(ctx: AppContext, factId: TravelFactId): Promise<void> {
  await candidate(ctx, factId);
  const without = (ids: readonly TravelFactId[]) => ids.filter((id) => id !== factId);
  for (const knowledge of await ctx.repos.knowledge.listArticleKnowledge()) {
    const referenced =
      knowledge.currentFactIds.includes(factId) ||
      knowledge.cautionFactIds.includes(factId) ||
      knowledge.experienceGroups.some((group) => group.factIds.includes(factId));
    if (referenced)
      await ctx.repos.knowledge.saveArticleKnowledge({
        ...knowledge,
        currentFactIds: without(knowledge.currentFactIds),
        cautionFactIds: without(knowledge.cautionFactIds),
        experienceGroups: knowledge.experienceGroups.map((group) => ({
          ...group,
          factIds: without(group.factIds),
        })),
      });
  }
  await ctx.repos.knowledge.deleteTravelFact(factId);
}

export interface PendingFact {
  readonly fact: TravelFact;
  readonly article: Article | null;
}

/** Every candidate, across articles: what the owner has to look at. */
export async function listPendingFacts(ctx: AppContext): Promise<readonly PendingFact[]> {
  const [facts, articles] = await Promise.all([
    ctx.repos.knowledge.listTravelFacts(),
    ctx.repos.articles.listAll(),
  ]);
  const byId = new Map(articles.map((article) => [article.id, article]));
  return facts
    .filter((fact) => fact.status === "candidate")
    .map((fact) => ({ fact, article: byId.get(fact.articleIds[0] as ArticleId) ?? null }));
}

/** Live articles that have no knowledge record and no facts yet. */
export async function listKnowledgeBacklog(
  ctx: AppContext,
): Promise<{ migrated: number; pending: readonly Article[] }> {
  const [articles, knowledge, facts] = await Promise.all([
    ctx.repos.articles.listAll(),
    ctx.repos.knowledge.listArticleKnowledge(),
    ctx.repos.knowledge.listTravelFacts(),
  ]);
  const covered = new Set<string>([
    ...knowledge.map((entry) => entry.articleId),
    ...facts.flatMap((fact) => fact.articleIds),
  ]);
  const now = ctx.clock.now();
  const live = articles.filter(
    (article) => article.kind === "article" && isPubliclyVisible(article, now),
  );
  return {
    migrated: live.filter((article) => covered.has(article.id)).length,
    pending: live.filter((article) => !covered.has(article.id)),
  };
}
