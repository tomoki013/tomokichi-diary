import { Hono } from "hono";
import { validate } from "@tomokichi/contracts";
import {
  checkPublishable,
  createArticle,
  deleteDiaryNote,
  listArticlesForAdmin,
  publishArticle,
  setDiaryNotePublicationDate,
  setDiaryNoteRelatedArticles,
  unpublishArticle,
  updateArticleDraft,
} from "@tomokichi/application";
import {
  instantFrom,
  parsePlainDate,
  RouteTable,
  type ArticleId,
  type AuthorId,
} from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import type { Env } from "../env.js";
import { domainErrorResponse, errorResponse } from "../http.js";
import { toArticleSummaryDto, toRevisionDto } from "../mappers.js";
import {
  createDiaryNoteSchema,
  diaryNoteDateSchema,
  diaryNoteDraftSchema,
  diaryNoteRelatedSchema,
  publishSchema,
} from "../schemas.js";

async function siteAuthor(ctx: AppEnv["Variables"]["ctx"]): Promise<AuthorId | null> {
  return (await ctx.repos.authors.listAll())[0]?.id ?? null;
}

function descriptionFor(title: string, markdown: string): string {
  const plain = markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (plain || title).slice(0, 400);
}

async function requireNote(c: {
  get: (key: "ctx") => AppEnv["Variables"]["ctx"];
  req: { param: (name: string) => string };
}) {
  const id = c.req.param("id") as ArticleId;
  const article = await c.get("ctx").repos.articles.findById(id);
  return article?.kind === "note" ? article : null;
}

export function diaryNoteRoutes(publishSite: (env: Env, deferBuild?: boolean) => Promise<unknown>) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const summaries = (await listArticlesForAdmin(c.get("ctx"))).filter(
      ({ article }) => article.kind === "note",
    );
    const [routesList, memberships, categories, locations] = await Promise.all([
      c.get("ctx").repos.routes.listAll(),
      c.get("ctx").repos.collections.listMemberships(),
      c.get("ctx").repos.relations.listArticleCategories(),
      c.get("ctx").repos.relations.listArticleLocations(),
    ]);
    const routeTable = new RouteTable(routesList);
    const membershipsByArticle = new Map<string, string[]>();
    for (const relation of memberships) {
      const items = membershipsByArticle.get(relation.articleId) ?? [];
      items.push(relation.collectionId);
      membershipsByArticle.set(relation.articleId, items);
    }
    const categoriesByArticle = new Map<string, string[]>();
    for (const relation of categories) {
      const items = categoriesByArticle.get(relation.articleId) ?? [];
      items.push(relation.categoryId);
      categoriesByArticle.set(relation.articleId, items);
    }
    const locationsByArticle = new Map<string, string[]>();
    for (const relation of locations) {
      const items = locationsByArticle.get(relation.articleId) ?? [];
      items.push(relation.locationId);
      locationsByArticle.set(relation.articleId, items);
    }
    return c.json({
      items: summaries.map(({ article, title, hasUnpublishedChanges, isLive }) =>
        toArticleSummaryDto({
          article,
          title,
          path: routeTable.canonicalFor("article", article.id)?.path ?? null,
          hasUnpublishedChanges,
          isLive,
          collectionIds: membershipsByArticle.get(article.id) ?? [],
          categoryIds: categoriesByArticle.get(article.id) ?? [],
          locationIds: locationsByArticle.get(article.id) ?? [],
        }),
      ),
      total: summaries.length,
    });
  });

  routes.post("/", async (c) => {
    const parsed = validate(createDiaryNoteSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const authorId = await siteAuthor(c.get("ctx"));
    if (!authorId) return errorResponse(c, "API_INTERNAL", "no author is on record", 500);
    const { slug, title, bodyMarkdown } = parsed.value;
    const created = await createArticle(c.get("ctx"), {
      slug,
      kind: "note",
      locale: "ja",
      authorId,
      path: `/notes/${slug}`,
      draft: {
        title,
        summary: descriptionFor(title, bodyMarkdown),
        bodyMarkdown,
        seoTitleOverride: null,
        seoDescriptionOverride: null,
        changeSummary: "一言日記の下書きを作成",
      },
      imageBase: c.env.PUBLIC_IMAGE_URL,
    });
    return created.ok
      ? c.json({ id: created.value.article.id }, 201)
      : domainErrorResponse(c, created.errors);
  });

  routes.put("/:id/draft", async (c) => {
    const note = await requireNote(c);
    if (!note) return errorResponse(c, "ARTICLE_NOT_FOUND", "diary note not found", 404);
    const parsed = validate(diaryNoteDraftSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const result = await updateArticleDraft(
      c.get("ctx"),
      note.id,
      {
        title: parsed.value.title,
        summary: descriptionFor(parsed.value.title, parsed.value.bodyMarkdown),
        bodyMarkdown: parsed.value.bodyMarkdown,
        seoTitleOverride: null,
        seoDescriptionOverride: null,
        changeSummary: "一言日記を編集",
      },
      note.authorId,
      c.env.PUBLIC_IMAGE_URL,
    );
    return result.ok
      ? c.json({ revision: toRevisionDto(result.value.revision) })
      : domainErrorResponse(c, result.errors);
  });

  routes.get("/:id/publish-check", async (c) => {
    if (!(await requireNote(c)))
      return errorResponse(c, "ARTICLE_NOT_FOUND", "diary note not found", 404);
    const problems = await checkPublishable(c.get("ctx"), c.req.param("id") as ArticleId);
    return c.json({
      publishable: problems.length === 0,
      problems: problems.map((problem) => ({
        code: problem.code,
        field: problem.field ?? null,
        message: problem.message,
      })),
    });
  });

  routes.post("/:id/publish", async (c) => {
    if (!(await requireNote(c)))
      return errorResponse(c, "ARTICLE_NOT_FOUND", "diary note not found", 404);
    const raw = (await c.req.text()).trim();
    const input: unknown = raw
      ? await Promise.resolve()
          .then(() => JSON.parse(raw))
          .catch(() => null)
      : {};
    const parsed = validate(publishSchema, input);
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const result = await publishArticle(c.get("ctx"), c.req.param("id") as ArticleId);
    return result.ok
      ? c.json({
          status: result.value.status,
          publication: await publishSite(c.env, parsed.value.deferBuild),
        })
      : domainErrorResponse(c, result.errors);
  });

  routes.post("/:id/unpublish", async (c) => {
    if (!(await requireNote(c)))
      return errorResponse(c, "ARTICLE_NOT_FOUND", "diary note not found", 404);
    const result = await unpublishArticle(c.get("ctx"), c.req.param("id") as ArticleId);
    return result.ok
      ? c.json({ status: result.value.status, publication: await publishSite(c.env) })
      : domainErrorResponse(c, result.errors);
  });

  routes.put("/:id/date", async (c) => {
    if (!(await requireNote(c)))
      return errorResponse(c, "ARTICLE_NOT_FOUND", "diary note not found", 404);
    const parsed = validate(diaryNoteDateSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    let publishedAt = null;
    if (parsed.value.date !== null) {
      const date = parsePlainDate(parsed.value.date);
      if (!date.ok) return domainErrorResponse(c, date.errors);
      // Store a date-only publication value at UTC midnight so its calendar
      // date remains stable in the public export and the editor.
      publishedAt = instantFrom(`${date.value}T00:00:00.000Z`);
    }
    const result = await setDiaryNotePublicationDate(
      c.get("ctx"),
      c.req.param("id") as ArticleId,
      publishedAt,
    );
    if (!result.ok) return domainErrorResponse(c, result.errors);
    const publication = result.value.status === "published" ? await publishSite(c.env) : null;
    return c.json({ date: result.value.publishedAt?.slice(0, 10) ?? null, publication });
  });

  routes.put("/:id/related-articles", async (c) => {
    if (!(await requireNote(c)))
      return errorResponse(c, "ARTICLE_NOT_FOUND", "diary note not found", 404);
    const parsed = validate(diaryNoteRelatedSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const result = await setDiaryNoteRelatedArticles(
      c.get("ctx"),
      c.req.param("id") as ArticleId,
      parsed.value.relatedArticleIds as ArticleId[],
    );
    return result.ok
      ? c.json({ relatedArticleIds: result.value })
      : domainErrorResponse(c, result.errors);
  });

  routes.delete("/:id", async (c) => {
    const note = await requireNote(c);
    if (!note) return errorResponse(c, "ARTICLE_NOT_FOUND", "diary note not found", 404);
    const body = (await c.req.json().catch(() => null)) as { confirm?: unknown } | null;
    if (body?.confirm !== "delete")
      return errorResponse(
        c,
        "API_VALIDATION_FAILED",
        "explicit delete confirmation is required",
        400,
      );
    const result = await deleteDiaryNote(c.get("ctx"), note.id);
    if (!result.ok) return domainErrorResponse(c, result.errors);
    const publication = note.status === "published" ? await publishSite(c.env) : null;
    return c.json({ deleted: true, publication });
  });

  return routes;
}
