import { Hono } from "hono";
import {
  validate,
  monetizationSettingsSchema,
  articleMonetizationSchema,
  affiliateOfferSchema,
  adExperimentSchema,
} from "@tomokichi/contracts";
import {
  articleMonetization,
  saveArticleMonetization,
  saveMonetizationSettings,
  saveAffiliateOffer,
  saveAdExperiment,
  validateArticleMonetization,
} from "@tomokichi/application";
import { isPubliclyVisible, type ArticleId } from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { errorResponse, domainErrorResponse } from "../http.js";
export function monetizationRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => {
    await next();
    c.header("cache-control", "private, no-store");
    c.header("x-robots-tag", "noindex, nofollow");
  });
  routes.get("/", async (c) => {
    const repo = c.get("ctx").repos.monetization;
    const published = new Map(
      (await c.get("ctx").repos.publicationMetadata.listAll()).map((m) => [
        m.revisionId,
        m.metadata.monetization,
      ]),
    );
    const publishedAdArticles = (await c.get("ctx").repos.articles.listAll()).filter(
      (a) =>
        a.kind === "article" &&
        isPubliclyVisible(a, c.get("ctx").clock.now()) &&
        (a.publishedRevisionId
          ? published.get(a.publishedRevisionId)
            ? Boolean(
                published.get(a.publishedRevisionId)?.enabled &&
                (published.get(a.publishedRevisionId)?.placement ||
                  published.get(a.publishedRevisionId)?.experiment),
              )
            : true
          : false),
    ).length;
    return c.json({
      publishedAdArticles,
      settings: await repo.settings(),
      articles: await repo.listArticles(),
      offers: await repo.offers(),
      experiments: await repo.experiments(),
    });
  });
  routes.put("/settings", async (c) => {
    const parsed = validate(monetizationSettingsSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "設定を確認してください", 400, parsed.issues);
    const result = await saveMonetizationSettings(c.get("ctx"), parsed.value);
    return result.ok ? c.json(result.value) : domainErrorResponse(c, result.errors);
  });
  routes.get("/articles/:id", async (c) => {
    const result = await articleMonetization(c.get("ctx"), c.req.param("id") as ArticleId);
    return result ? c.json(result) : errorResponse(c, "ARTICLE_NOT_FOUND", "記事がありません", 404);
  });
  routes.put("/articles/:id", async (c) => {
    const parsed = validate(articleMonetizationSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "配置を確認してください", 400, parsed.issues);
    const result = await saveArticleMonetization(
      c.get("ctx"),
      c.req.param("id") as ArticleId,
      parsed.value,
    );
    return result.ok ? c.json(result.value) : domainErrorResponse(c, result.errors);
  });
  routes.get("/articles/:id/validate", async (c) =>
    c.json({
      problems: await validateArticleMonetization(c.get("ctx"), c.req.param("id") as ArticleId),
    }),
  );
  routes.post("/offers", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const input =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? { ...body, id: c.get("ctx").ids.next() }
        : null;
    const parsed = validate(affiliateOfferSchema, input);
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "案件を確認してください", 400, parsed.issues);
    const result = await saveAffiliateOffer(c.get("ctx"), parsed.value);
    return result.ok ? c.json(result.value, 201) : domainErrorResponse(c, result.errors);
  });
  routes.put("/offers/:id", async (c) => {
    const parsed = validate(affiliateOfferSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "案件を確認してください", 400, parsed.issues);
    if (parsed.value.id !== c.req.param("id"))
      return errorResponse(c, "MONETIZATION_INVALID", "案件IDが一致しません", 400);
    const result = await saveAffiliateOffer(c.get("ctx"), parsed.value);
    return result.ok ? c.json(result.value) : domainErrorResponse(c, result.errors);
  });
  // Deletion is archival so all existing placements remain assignable.
  routes.delete("/offers/:id", async (c) => {
    const offer = (await c.get("ctx").repos.monetization.offers()).find(
      (o) => o.id === c.req.param("id"),
    );
    if (!offer) return errorResponse(c, "API_NOT_FOUND", "案件がありません", 404);
    const result = await saveAffiliateOffer(c.get("ctx"), { ...offer, status: "archived" });
    return result.ok ? c.json(result.value) : domainErrorResponse(c, result.errors);
  });
  routes.put("/experiments/:id", async (c) => {
    const parsed = validate(adExperimentSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "実験を確認してください", 400, parsed.issues);
    if (parsed.value.id !== c.req.param("id"))
      return errorResponse(c, "MONETIZATION_INVALID", "実験IDが一致しません", 400);
    const result = await saveAdExperiment(c.get("ctx"), parsed.value);
    return result.ok ? c.json(result.value) : domainErrorResponse(c, result.errors);
  });
  routes.post("/experiments/:id/:action", async (c) => {
    const action = c.req.param("action");
    if (action !== "start" && action !== "stop")
      return errorResponse(c, "API_NOT_FOUND", "操作がありません", 404);
    const experiment = (await c.get("ctx").repos.monetization.experiments()).find(
      (e) => e.id === c.req.param("id"),
    );
    if (!experiment) return errorResponse(c, "API_NOT_FOUND", "実験がありません", 404);
    const result = await saveAdExperiment(c.get("ctx"), experiment, action);
    return result.ok ? c.json(result.value) : domainErrorResponse(c, result.errors);
  });
  return routes;
}
