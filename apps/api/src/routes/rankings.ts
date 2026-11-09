import { Hono } from "hono";
import { createRanking, updateRanking, type RankingInput } from "@tomokichi/application";
import type { RankingAdminDto } from "@tomokichi/contracts";
import {
  isPubliclyVisible,
  type MediaId,
  type RankingId,
  type RevisionId,
} from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { domainErrorResponse, errorResponse } from "../http.js";
import { thumbnailKey } from "../mappers.js";

type Ctx = AppEnv["Variables"]["ctx"];

/** Builds ranking DTOs, naming picks and resolving the manually chosen photo. */
async function rankingDtos(ctx: Ctx, only?: RankingId): Promise<RankingAdminDto[]> {
  const [rankings, articles] = await Promise.all([
    ctx.repos.rankings.listAll(),
    ctx.repos.articles.listAll(),
  ]);
  const chosen = only ? rankings.filter((item) => item.id === only) : rankings;
  const picked = new Set(chosen.flatMap((ranking) => ranking.picks.map((pick) => pick.articleId)));
  const articleById = new Map(articles.filter((a) => picked.has(a.id)).map((a) => [a.id, a]));
  const revisions = await ctx.repos.revisions.listByIds(
    [...articleById.values()].flatMap((a) =>
      a.currentRevisionId ? [a.currentRevisionId as RevisionId] : [],
    ),
  );
  const titleOf = new Map(revisions.map((revision) => [revision.articleId, revision.title]));
  const photoIds = [
    ...new Set(
      chosen
        .map((ranking) => ranking.photoMediaId)
        .filter((photoId): photoId is MediaId => photoId !== null),
    ),
  ];
  const photos = await Promise.all(photoIds.map((photoId) => ctx.repos.media.findById(photoId)));
  const photoById = new Map(photos.filter((photo) => photo !== null).map((photo) => [photo.id, photo]));
  const now = ctx.clock.now();
  return chosen.map((ranking) => {
    const photo = ranking.photoMediaId ? (photoById.get(ranking.photoMediaId) ?? null) : null;
    const thumbnail = photo ? thumbnailKey(photo) : null;
    const picks = ranking.picks.map((pick) => {
      const article = articleById.get(pick.articleId);
      return {
        articleId: pick.articleId,
        comment: pick.comment,
        slug: article?.slug ?? "",
        title: titleOf.get(pick.articleId) ?? article?.slug ?? "",
        live: article ? isPubliclyVisible(article, now) : false,
      };
    });
    return {
      id: ranking.id,
      title: ranking.title,
      note: ranking.note,
      experienceTag: ranking.experienceTag,
      photo: photo
        ? {
            mediaId: photo.id,
            url: ctx.mediaUrls.resolve(photo.storageKey),
            thumbnailUrl: thumbnail ? ctx.mediaUrls.resolve(thumbnail) : null,
            label: photo.slug ?? photo.originalName ?? photo.id,
          }
        : null,
      sortOrder: ranking.sortOrder,
      picks,
      liveCount: picks.filter((pick) => pick.live).length,
      updatedAt: ranking.updatedAt,
    };
  });
}

async function readBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function rankingInput(body: Record<string, unknown>): RankingInput {
  const pick = (key: keyof RankingInput) => (key in body ? { [key]: body[key] } : {});
  return {
    ...pick("title"),
    ...pick("note"),
    ...pick("experienceTag"),
    ...pick("photoMediaId"),
    ...pick("picks"),
    ...pick("sortOrder"),
  };
}

/**
 * The home page's rankings. Created and edited here, never deleted (emptying
 * the picks hides one). Changes reach the site with the next publication.
 */
export function rankingRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => c.json({ items: await rankingDtos(c.get("ctx")) }));

  routes.get("/:id", async (c) => {
    const [item] = await rankingDtos(c.get("ctx"), c.req.param("id") as RankingId);
    return item
      ? c.json(item)
      : errorResponse(c, "RANKING_NOT_FOUND", `no ranking ${c.req.param("id")}`, 404);
  });

  routes.post("/", async (c) => {
    const body = await readBody(c);
    if (!body) return errorResponse(c, "API_VALIDATION_FAILED", "invalid request body", 400);
    const ctx = c.get("ctx");
    const result = await createRanking(ctx, rankingInput(body));
    if (!result.ok) return domainErrorResponse(c, result.errors);
    const [item] = await rankingDtos(ctx, result.value.id);
    return c.json(item, 201);
  });

  routes.patch("/:id", async (c) => {
    const body = await readBody(c);
    if (!body) return errorResponse(c, "API_VALIDATION_FAILED", "invalid request body", 400);
    const ctx = c.get("ctx");
    const id = c.req.param("id") as RankingId;
    const result = await updateRanking(ctx, id, rankingInput(body));
    if (!result.ok) return domainErrorResponse(c, result.errors);
    const [item] = await rankingDtos(ctx, id);
    return c.json(item);
  });

  return routes;
}
