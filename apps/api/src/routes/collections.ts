import { Hono } from "hono";
import { createCollection, createTag, updateCollection } from "@tomokichi/application";
import type { CollectionAdminDto, TagDto } from "@tomokichi/contracts";
import { isPubliclyVisible, type Collection, type CollectionId } from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { domainErrorResponse, errorResponse } from "../http.js";
import { thumbnailKey } from "../mappers.js";

type Ctx = AppEnv["Variables"]["ctx"];

async function readBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

const optionalString = (value: unknown): string | null | undefined =>
  value === undefined
    ? undefined
    : value === null
      ? null
      : typeof value === "string"
        ? value
        : undefined;

/** Builds the DTOs for every collection in one pass over the tables. */
async function collectionDtos(ctx: Ctx, only?: CollectionId): Promise<CollectionAdminDto[]> {
  const [collections, memberships, articles, routes] = await Promise.all([
    ctx.repos.collections.listAll(),
    ctx.repos.collections.listMemberships(),
    ctx.repos.articles.listAll(),
    ctx.repos.routes.listAll(),
  ]);
  const now = ctx.clock.now();
  const live = new Set(
    articles.filter((article) => isPubliclyVisible(article, now)).map((article) => article.id),
  );
  const chosen = only ? collections.filter((item) => item.id === only) : collections;
  return Promise.all(
    chosen.map(async (collection: Collection) => {
      const members = memberships.filter((m) => m.collectionId === collection.id);
      const route = routes.find(
        (r) => r.targetType === collection.kind && r.targetId === collection.id && r.isCanonical,
      );
      const cover = collection.coverMediaId
        ? await ctx.repos.media.findById(collection.coverMediaId)
        : null;
      const thumb = cover ? thumbnailKey(cover) : null;
      return {
        id: collection.id,
        slug: collection.slug,
        kind: collection.kind,
        title: collection.title,
        description: collection.description,
        coverMediaId: collection.coverMediaId,
        coverUrl: cover ? ctx.mediaUrls.resolve(thumb ?? cover.storageKey) : null,
        sortOrder: collection.sortOrder,
        path: route?.path ?? null,
        publishedCount: members.filter((m) => live.has(m.articleId)).length,
        memberCount: members.length,
      };
    }),
  ).then((items) =>
    items.toSorted((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug)),
  );
}

/**
 * Series and journeys, and the tags articles are filed under. Created and
 * edited here; never deleted, so an existing URL cannot vanish by mistake.
 * Changes reach the site with the next publication.
 */
export function collectionRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/collections", async (c) => {
    const kind = c.req.query("kind");
    const items = await collectionDtos(c.get("ctx"));
    return c.json({ items: kind ? items.filter((item) => item.kind === kind) : items });
  });

  routes.get("/collections/:id", async (c) => {
    const [item] = await collectionDtos(c.get("ctx"), c.req.param("id") as CollectionId);
    return item
      ? c.json(item)
      : errorResponse(c, "COLLECTION_NOT_FOUND", `no collection ${c.req.param("id")}`, 404);
  });

  routes.post("/collections", async (c) => {
    const body = await readBody(c);
    if (!body) return errorResponse(c, "API_VALIDATION_FAILED", "invalid request body", 400);
    const ctx = c.get("ctx");
    const result = await createCollection(ctx, {
      kind: typeof body["kind"] === "string" ? body["kind"] : "series",
      slug: typeof body["slug"] === "string" ? body["slug"] : "",
      title: typeof body["title"] === "string" ? body["title"] : "",
      description: optionalString(body["description"]) ?? null,
      coverMediaId: optionalString(body["coverMediaId"]) ?? null,
      sortOrder: typeof body["sortOrder"] === "number" ? body["sortOrder"] : null,
    });
    if (!result.ok) return domainErrorResponse(c, result.errors);
    const [item] = await collectionDtos(ctx, result.value.collection.id);
    return c.json(item, 201);
  });

  routes.patch("/collections/:id", async (c) => {
    const body = await readBody(c);
    if (!body) return errorResponse(c, "API_VALIDATION_FAILED", "invalid request body", 400);
    if ("slug" in body || "kind" in body)
      return errorResponse(
        c,
        "API_VALIDATION_FAILED",
        "slug and kind cannot change after creation",
        400,
        [{ path: "slug", message: "slug and kind cannot change after creation" }],
      );
    const ctx = c.get("ctx");
    const id = c.req.param("id") as CollectionId;
    const result = await updateCollection(ctx, id, {
      ...(typeof body["title"] === "string" ? { title: body["title"] } : {}),
      ...("description" in body
        ? { description: optionalString(body["description"]) ?? null }
        : {}),
      ...("coverMediaId" in body
        ? { coverMediaId: optionalString(body["coverMediaId"]) ?? null }
        : {}),
      ...(typeof body["sortOrder"] === "number" ? { sortOrder: body["sortOrder"] } : {}),
    });
    if (!result.ok) return domainErrorResponse(c, result.errors);
    const [item] = await collectionDtos(ctx, id);
    return c.json(item);
  });

  routes.post("/tags", async (c) => {
    const body = await readBody(c);
    if (!body) return errorResponse(c, "API_VALIDATION_FAILED", "invalid request body", 400);
    const result = await createTag(c.get("ctx"), {
      slug: typeof body["slug"] === "string" ? body["slug"] : "",
      name: typeof body["name"] === "string" ? body["name"] : "",
    });
    if (!result.ok) return domainErrorResponse(c, result.errors);
    const tag: TagDto = { id: result.value.id, slug: result.value.slug, name: result.value.name };
    return c.json(tag, 201);
  });

  return routes;
}
