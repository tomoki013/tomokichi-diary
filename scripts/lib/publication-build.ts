import type { SqlDatabase } from "@tomokichi/infra-d1";
import type { PublicationStage, PublicationStageResult } from "@tomokichi/contracts";

export interface PublicationBuild {
  requestId: string;
  buildId: string;
}

/** Code releases and content releases both need a distinct, observable build. */
export async function beginPublicationBuild(
  db: SqlDatabase,
  options: {
    force: boolean;
    requestId: string;
    buildId?: string;
    now: string;
    buildUrl: string | null;
  },
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT requested_id, requested_at, deployed_id FROM site_publication WHERE id = 'site'",
    )
    .first<{
      requested_id: string | null;
      requested_at: string | null;
      deployed_id: string | null;
    }>();
  const pending = Boolean(row?.requested_id && row.requested_id !== row.deployed_id);
  if (!options.force && !pending) return null;
  const requestId = pending ? row!.requested_id! : options.requestId;
  const buildId = options.buildId ?? crypto.randomUUID();
  // A newer editor request may arrive after the read. Keep it queued rather
  // than replacing it with the code release's request ID.
  await db
    .prepare(
      "UPDATE site_publication SET requested_id = CASE WHEN requested_id IS ? THEN ? ELSE requested_id END, requested_at = CASE WHEN requested_id IS ? THEN ? ELSE requested_at END, building_id = ?, build_url = ?, active_build_id = ?, failed_id = NULL, error = NULL WHERE id = 'site'",
    )
    .bind(
      row?.requested_id ?? null,
      requestId,
      row?.requested_id ?? null,
      pending ? row!.requested_at : options.now,
      requestId,
      options.buildUrl,
      buildId,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO publication_builds
    (build_id, request_id, requested_at, started_at, stage, stage_started_at, build_url, stages)
    VALUES (?, ?, ?, ?, 'data', ?, ?, ?)`,
    )
    .bind(
      buildId,
      requestId,
      (pending ? row!.requested_at : null) ?? options.now,
      options.now,
      options.now,
      options.buildUrl,
      JSON.stringify({ data: { startedAt: options.now, state: "running" } }),
    )
    .run();
  return requestId;
}

/** Every mutation is fenced by both request and execution (including Actions retries). */
export async function progressPublicationBuild(
  db: SqlDatabase,
  build: PublicationBuild,
  stage: PublicationStage,
  state: PublicationStageResult["state"],
  now: string,
) {
  const row = await db
    .prepare(
      `SELECT stages FROM publication_builds WHERE build_id = ? AND request_id = ?
    AND state = 'building' AND EXISTS (SELECT 1 FROM site_publication WHERE active_build_id = ? AND building_id = ?)`,
    )
    .bind(build.buildId, build.requestId, build.buildId, build.requestId)
    .first<{ stages: string }>();
  if (!row) return;
  const stages = JSON.parse(row.stages) as Partial<
    Record<PublicationStage, PublicationStageResult>
  >;
  // A stage can contain multiple commands (R2 sync, MCP deploy, web deploy).
  // Keep its first start so the total includes every command and the gaps.
  const startedAt = stages[stage]?.startedAt ?? now;
  stages[stage] = {
    startedAt,
    state,
    ...(state === "running"
      ? {}
      : { finishedAt: now, durationMs: Math.max(0, Date.parse(now) - Date.parse(startedAt)) }),
  };
  await db
    .prepare(
      `UPDATE publication_builds SET stage = ?, stage_started_at = ?, stages = ?
    WHERE build_id = ? AND request_id = ? AND state = 'building'
    AND EXISTS (SELECT 1 FROM site_publication WHERE active_build_id = ? AND building_id = ?)`,
    )
    .bind(
      stage,
      startedAt,
      JSON.stringify(stages),
      build.buildId,
      build.requestId,
      build.buildId,
      build.requestId,
    )
    .run();
}

export async function finishPublicationBuild(
  db: SqlDatabase,
  build: PublicationBuild,
  now: string,
  failure?: { code: string; message: string },
) {
  const active = await db
    .prepare(
      `SELECT stage FROM publication_builds WHERE build_id = ? AND request_id = ?
    AND state = 'building' AND EXISTS (SELECT 1 FROM site_publication WHERE active_build_id = ? AND building_id = ?)`,
    )
    .bind(build.buildId, build.requestId, build.buildId, build.requestId)
    .first<{ stage: PublicationStage }>();
  if (!active) return;
  await progressPublicationBuild(db, build, active.stage, failure ? "failed" : "completed", now);
  await db.batch([
    db
      .prepare(
        `UPDATE publication_builds SET state = ?, finished_at = ?,
      duration_ms = MAX(0, CAST((julianday(?) - julianday(requested_at)) * 86400000 AS INTEGER)),
      error_code = ?, error = ? WHERE build_id = ? AND request_id = ? AND state = 'building'
      AND EXISTS (SELECT 1 FROM site_publication WHERE active_build_id = ? AND building_id = ?)`,
      )
      .bind(
        failure ? "failed" : "deployed",
        now,
        now,
        failure?.code ?? null,
        failure?.message ?? null,
        build.buildId,
        build.requestId,
        build.buildId,
        build.requestId,
      ),
    failure
      ? db
          .prepare(
            `UPDATE site_publication SET failed_id = ?, error = ?, building_id = NULL
          WHERE id = 'site' AND active_build_id = ? AND building_id = ?`,
          )
          .bind(build.requestId, failure.message, build.buildId, build.requestId)
      : db
          .prepare(
            `UPDATE site_publication SET deployed_id = ?, deployed_at = ?, building_id = NULL,
          failed_id = CASE WHEN failed_id = ? THEN NULL ELSE failed_id END,
          error = CASE WHEN failed_id = ? THEN NULL ELSE error END
          WHERE id = 'site' AND active_build_id = ? AND building_id = ?`,
          )
          .bind(
            build.requestId,
            now,
            build.requestId,
            build.requestId,
            build.buildId,
            build.requestId,
          ),
  ]);
}
