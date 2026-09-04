import { Hono } from "hono";
import {
  getEditableKnowledge,
  saveEditableKnowledge,
  verifyFirsthandCandidate,
  suggestTravelFactCandidates,
} from "@tomokichi/application";
import { validate, type ArticleKnowledgeBundleDto } from "@tomokichi/contracts";
import type {
  ArticleId,
  ArticleKnowledge,
  SourceReference,
  TravelFact,
  TravelFactId,
  TravelRoute,
} from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";
import { knowledgeBundleSchema } from "../schemas.js";

const toDto = (
  bundle: Awaited<ReturnType<typeof getEditableKnowledge>>,
): ArticleKnowledgeBundleDto => bundle as ArticleKnowledgeBundleDto;

export function knowledgeRoutes() {
  const routes = new Hono<AppEnv>();
  routes.get("/article/:id", async (c) => {
    const articleId = c.req.param("id") as ArticleId;
    if (!(await c.get("ctx").repos.articles.findById(articleId)))
      return errorResponse(c, "ARTICLE_NOT_FOUND", `no article ${articleId}`, 404);
    return c.json(toDto(await getEditableKnowledge(c.get("ctx"), articleId)));
  });

  routes.put("/article/:id", async (c) => {
    const parsed = validate(knowledgeBundleSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid knowledge body", 400, parsed.issues);
    try {
      const result = await saveEditableKnowledge(c.get("ctx"), c.req.param("id") as ArticleId, {
        article: parsed.value.article as ArticleKnowledge | null,
        facts: parsed.value.facts as unknown as readonly TravelFact[],
        sources: parsed.value.sources as unknown as readonly SourceReference[],
        routes: parsed.value.routes as unknown as readonly TravelRoute[],
      });
      return c.json(toDto(result));
    } catch (error) {
      return errorResponse(c, "API_VALIDATION_FAILED", (error as Error).message, 400);
    }
  });

  routes.post("/facts/:id/verify", async (c) => {
    const ctx = c.get("ctx");
    const factId = c.req.param("id") as TravelFactId;
    const fact = (await ctx.repos.knowledge.listTravelFacts()).find((entry) => entry.id === factId);
    if (!fact) return errorResponse(c, "API_NOT_FOUND", `no travel fact ${factId}`, 404);
    const article = await ctx.repos.articles.findById(fact.articleIds[0] as ArticleId);
    if (!article) return errorResponse(c, "ARTICLE_NOT_FOUND", "fact has no valid article", 404);
    try {
      return c.json(await verifyFirsthandCandidate(ctx, factId, article.authorId));
    } catch (error) {
      return errorResponse(c, "API_VALIDATION_FAILED", (error as Error).message, 400);
    }
  });
  routes.post("/article/:id/suggestions", async (c) => {
    try {
      const result = await suggestTravelFactCandidates(
        c.get("ctx"),
        c.req.param("id") as ArticleId,
      );
      return c.json(result, result.available ? 200 : 200);
    } catch (error) {
      return errorResponse(c, "API_VALIDATION_FAILED", (error as Error).message, 400);
    }
  });
  return routes;
}
