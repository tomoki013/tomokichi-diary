import { Hono } from "hono";
import { fromD1, type SqlDatabase } from "@tomokichi/infra-d1";
import type { AppEnv } from "./app.js";
import type { Env } from "./env.js";

export interface PublicationRow {
  requested_id: string | null;
  requested_at: string | null;
  building_id: string | null;
  deployed_id: string | null;
  deployed_at: string | null;
  failed_id: string | null;
  error: string | null;
  build_url: string | null;
}
export async function publicationStatus(db: SqlDatabase, configured: boolean) {
  const row = await db
    .prepare("SELECT * FROM site_publication WHERE id = 'site'")
    .first<PublicationRow>();
  const state =
    !row?.requested_id || row.requested_id === row.deployed_id
      ? "deployed"
      : !configured
        ? "unconfigured"
        : row.failed_id === row.requested_id
          ? "failed"
          : row.building_id === row.requested_id
            ? "building"
            : "queued";
  return {
    state,
    configured,
    requestedAt: row?.requested_at ?? null,
    deployedAt: row?.deployed_at ?? null,
    buildUrl: row?.build_url ?? null,
    error: row?.failed_id === row?.requested_id ? (row?.error ?? null) : null,
  };
}

/** Dispatches the existing repository's content workflow; no Cloudflare deployment credential lives in this Worker. */
export async function requestPublication(env: Env, db = fromD1(env.DB), dispatch = fetch) {
  const requestId = crypto.randomUUID();
  await db
    .prepare(
      "UPDATE site_publication SET requested_id = ?, requested_at = ?, failed_id = NULL, error = NULL WHERE id = 'site'",
    )
    .bind(requestId, new Date().toISOString())
    .run();
  if (!env.GITHUB_PUBLISH_TOKEN?.trim()) return publicationStatus(db, false);
  try {
    const response = await dispatch(
      "https://api.github.com/repos/tomoki013/tomokichi-diary/actions/workflows/publish.yml/dispatches",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.GITHUB_PUBLISH_TOKEN.trim()}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "tomokichi-diary-api",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main", inputs: { request_id: requestId } }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new Error(`公開処理を起動できませんでした（GitHub HTTP ${response.status}）`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "公開処理を起動できませんでした";
    await db
      .prepare(
        "UPDATE site_publication SET failed_id = ?, error = ? WHERE id = 'site' AND requested_id = ?",
      )
      .bind(requestId, message, requestId)
      .run();
  }
  return publicationStatus(db, true);
}

export function publicationRoutes() {
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) =>
    publicationStatus(fromD1(c.env.DB), Boolean(c.env.GITHUB_PUBLISH_TOKEN)).then((status) =>
      c.json(status),
    ),
  );
  routes.post("/retry", (c) => requestPublication(c.env).then((status) => c.json(status, 202)));
  return routes;
}
