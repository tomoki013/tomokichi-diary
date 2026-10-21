import { Hono } from "hono";
import { fromD1, type SqlDatabase } from "@tomokichi/infra-d1";
import type { AppEnv } from "./app.js";
import type { Env } from "./env.js";
import type {
  SitePublicationStatus,
  PublicationStage,
  PublicationStageResult,
} from "@tomokichi/contracts";

export interface PublicationRow {
  requested_id: string | null;
  requested_at: string | null;
  building_id: string | null;
  deployed_id: string | null;
  deployed_at: string | null;
  failed_id: string | null;
  error: string | null;
  build_url: string | null;
  active_build_id: string | null;
}
export async function publicationStatus(
  db: SqlDatabase,
  configured: boolean,
): Promise<SitePublicationStatus> {
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
  // An older build may still be running while the latest editor request waits.
  // Never attach that build's progress, failure or log to the newer request.
  const build =
    row?.active_build_id && row.requested_id
      ? await db
          .prepare("SELECT * FROM publication_builds WHERE build_id = ? AND request_id = ?")
          .bind(row.active_build_id, row.requested_id)
          .first<{
            build_id: string;
            stage: PublicationStage;
            started_at: string;
            stage_started_at: string;
            duration_ms: number | null;
            error_code: string | null;
            build_url: string | null;
            stages: string;
          }>()
      : null;
  const finished = state === "deployed" || state === "failed";
  return {
    state,
    configured,
    requestId: row?.requested_id ?? null,
    buildId: build?.build_id ?? null,
    stage: build?.stage ?? null,
    requestedAt: row?.requested_at ?? null,
    startedAt: build?.started_at ?? null,
    stageStartedAt: build?.stage_started_at ?? null,
    deployedAt: row?.deployed_at ?? null,
    durationMs: finished ? (build?.duration_ms ?? null) : null,
    elapsedMs: row?.requested_at
      ? finished
        ? (build?.duration_ms ?? null)
        : Math.max(0, Date.now() - Date.parse(row.requested_at))
      : null,
    stages: build
      ? (JSON.parse(build.stages) as Partial<Record<PublicationStage, PublicationStageResult>>)
      : {},
    errorCode: state === "failed" ? (build?.error_code ?? "DISPATCH_FAILED") : null,
    buildUrl:
      build?.build_url ??
      (row?.building_id === row?.requested_id ? (row?.build_url ?? null) : null),
    error: row?.failed_id === row?.requested_id ? (row?.error ?? null) : null,
  };
}

/** Dispatches the existing repository's content workflow; no Cloudflare deployment credential lives in this Worker. */
export async function requestPublication(
  env: Env,
  db = fromD1(env.DB),
  dispatch = fetch,
  deferBuild = false,
) {
  const requestId = crypto.randomUUID();
  await db
    .prepare(
      "UPDATE site_publication SET requested_id = ?, requested_at = ?, failed_id = NULL, error = NULL WHERE id = 'site'",
    )
    .bind(requestId, new Date().toISOString())
    .run();
  if (!env.GITHUB_PUBLISH_TOKEN?.trim()) return publicationStatus(db, false);
  // Bulk publishing records every successful change before dispatching once.
  // The scheduled workflow can recover the pending request if the tab closes.
  if (deferBuild) return publicationStatus(db, true);
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

export function publicationRoutes(
  publishSite: (env: Env) => Promise<unknown> = requestPublication,
) {
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) =>
    publicationStatus(fromD1(c.env.DB), Boolean(c.env.GITHUB_PUBLISH_TOKEN)).then((status) =>
      c.json(status),
    ),
  );
  routes.post("/retry", (c) => publishSite(c.env).then((status) => c.json(status, 202)));
  return routes;
}
