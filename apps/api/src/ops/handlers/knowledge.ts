import {
  getEditableKnowledge,
  listKnowledgeBacklog,
  listPendingFacts,
  proposeTravelFacts,
  rejectFactCandidate,
  saveEditableKnowledge,
  verifyFactCandidate,
} from "@tomokichi/application";
import { validate, type ArticleKnowledgeBundleDto, type TravelFactDto } from "@tomokichi/contracts";
import {
  RouteTable,
  type ArticleId,
  type ArticleKnowledge,
  type SourceReference,
  type TravelFact,
  type TravelFactId,
  type TravelRoute,
} from "@tomokichi/domain";
import { knowledgeBundleSchema } from "../../schemas.js";
import { invalid, notFound, OpError, type Handlers } from "../scope.js";
import { siteAuthor } from "./content.js";

type Names =
  | "knowledge.get"
  | "knowledge.save"
  | "knowledge.proposeFacts"
  | "knowledge.backlog"
  | "knowledge.pending"
  | "knowledge.reviewFact";

const toDto = (bundle: Awaited<ReturnType<typeof getEditableKnowledge>>) =>
  bundle as unknown as ArticleKnowledgeBundleDto;
const factDto = (fact: TravelFact) => fact as unknown as TravelFactDto;

/** The knowledge rules speak in plain errors; a caller sees them as a refusal, not a crash. */
async function ruled<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OpError) throw error;
    throw invalid(error instanceof Error ? error.message : "invalid knowledge");
  }
}

export const knowledgeHandlers: Handlers<Names> = {
  "knowledge.get": async ({ ctx }, { articleId }) => {
    if (!(await ctx.repos.articles.findById(articleId as ArticleId)))
      throw notFound("ARTICLE_NOT_FOUND", `no article ${articleId}`);
    return toDto(await getEditableKnowledge(ctx, articleId as ArticleId));
  },

  "knowledge.save": async ({ ctx }, { articleId, bundle }) => {
    const parsed = validate(knowledgeBundleSchema, bundle);
    if (!parsed.ok) throw new OpError(parsed.code, "invalid knowledge body", 400, parsed.issues);
    return ruled(async () =>
      toDto(
        await saveEditableKnowledge(ctx, articleId as ArticleId, {
          article: parsed.value.article as ArticleKnowledge | null,
          facts: parsed.value.facts as unknown as readonly TravelFact[],
          sources: parsed.value.sources as unknown as readonly SourceReference[],
          routes: parsed.value.routes as unknown as readonly TravelRoute[],
        }),
      ),
    );
  },

  "knowledge.proposeFacts": async ({ ctx }, { articleId, facts }) => {
    if (!(await ctx.repos.articles.findById(articleId as ArticleId)))
      throw notFound("ARTICLE_NOT_FOUND", `no article ${articleId}`);
    return ruled(async () => ({
      added: (await proposeTravelFacts(ctx, articleId as ArticleId, facts)).map(factDto),
    }));
  },

  "knowledge.backlog": async ({ ctx }) => {
    const [backlog, routes] = await Promise.all([
      listKnowledgeBacklog(ctx),
      ctx.repos.routes.listAll(),
    ]);
    const table = new RouteTable(routes);
    const revisions = await ctx.repos.revisions.listByIds(
      backlog.pending.flatMap((article) =>
        article.currentRevisionId ? [article.currentRevisionId] : [],
      ),
    );
    const titleOf = new Map(revisions.map((revision) => [revision.articleId, revision.title]));
    return {
      migrated: backlog.migrated,
      pending: backlog.pending.length,
      items: backlog.pending.map((article) => ({
        id: article.id,
        slug: article.slug,
        title: titleOf.get(article.id) ?? article.slug,
        path: table.canonicalFor("article", article.id)?.path ?? null,
      })),
    };
  },

  "knowledge.pending": async ({ ctx }) => {
    const pending = await listPendingFacts(ctx);
    const revisions = await ctx.repos.revisions.listByIds(
      pending.flatMap(({ article }) =>
        article?.currentRevisionId ? [article.currentRevisionId] : [],
      ),
    );
    const titleOf = new Map(revisions.map((revision) => [revision.articleId, revision.title]));
    return {
      items: pending.map(({ fact, article }) => ({
        ...factDto(fact),
        article: article
          ? { id: article.id, slug: article.slug, title: titleOf.get(article.id) ?? article.slug }
          : null,
      })),
    };
  },

  // Reachable from the admin only (`admin-only`): the owner, signed in.
  "knowledge.reviewFact": async ({ ctx }, { factId, decision }) =>
    ruled(async () => {
      if (decision === "reject") {
        await rejectFactCandidate(ctx, factId as TravelFactId);
        return { fact: null };
      }
      return {
        fact: factDto(
          await verifyFactCandidate(ctx, factId as TravelFactId, await siteAuthor(ctx)),
        ),
      };
    }),
};
