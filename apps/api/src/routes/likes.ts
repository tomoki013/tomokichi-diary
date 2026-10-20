import { Hono } from "hono";
import type { LikeActivityDto } from "@tomokichi/contracts";
import {
  getArticleLikeState,
  getLikeActivity,
  listArticleLikeCounts,
  toggleArticleLike,
} from "@tomokichi/application";
import type { ArticleId } from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

const VISITOR_ID = /^[a-zA-Z0-9-]{20,80}$/;

async function hashVisitor(value: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function likeRoutes() {
  const routes = new Hono<AppEnv>();

  // Counts only, no visitor state: the same answer for everyone, so it can be
  // cached briefly. The archive uses it to sort by likes.
  routes.get("/", async (c) => {
    c.header("cache-control", "public, max-age=60");
    return c.json({ counts: await listArticleLikeCounts(c.get("ctx")) });
  });

  routes.get("/:articleId", async (c) => {
    const visitorId = c.req.query("visitorId")?.trim();
    if (visitorId && !VISITOR_ID.test(visitorId)) {
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid visitor identity", 400);
    }
    const visitorHash = visitorId
      ? await hashVisitor(visitorId, c.env.LIKE_HASH_SALT ?? "tomokichi-like-v1")
      : undefined;
    const state = await getArticleLikeState(
      c.get("ctx"),
      c.req.param("articleId") as ArticleId,
      visitorHash,
    );
    return state ? c.json(state) : errorResponse(c, "ARTICLE_NOT_FOUND", "article not found", 404);
  });

  routes.post("/:articleId", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { visitorId?: unknown } | null;
    const visitorId = typeof body?.visitorId === "string" ? body.visitorId.trim() : "";
    if (!VISITOR_ID.test(visitorId)) {
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid visitor identity", 400);
    }
    const visitorHash = await hashVisitor(visitorId, c.env.LIKE_HASH_SALT ?? "tomokichi-like-v1");
    const state = await toggleArticleLike(
      c.get("ctx"),
      c.req.param("articleId") as ArticleId,
      visitorHash,
    );
    return state ? c.json(state) : errorResponse(c, "ARTICLE_NOT_FOUND", "article not found", 404);
  });

  return routes;
}

/** Mounted under `/admin`, behind the admin guard. */
export function likeAdminRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const activity: LikeActivityDto = await getLikeActivity(c.get("ctx"));
    return c.json(activity);
  });

  return routes;
}
