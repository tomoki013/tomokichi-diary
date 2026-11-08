import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromNodeSqlite, openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import { finishPublicationBuild } from "../publication-build.js";

function publicationDb(buildId: string, requestId: string) {
  const raw = openInMemoryDatabase();
  raw.exec(`
    CREATE TABLE site_publication (
      id TEXT PRIMARY KEY, active_build_id TEXT, building_id TEXT, failed_id TEXT,
      error TEXT, deployed_id TEXT, deployed_at TEXT, requested_id TEXT, requested_at TEXT
    );
    CREATE TABLE publication_builds (
      build_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, state TEXT NOT NULL,
      stage TEXT NOT NULL, stages TEXT NOT NULL, requested_at TEXT NOT NULL,
      started_at TEXT, stage_started_at TEXT, finished_at TEXT, duration_ms INTEGER,
      error_code TEXT, error TEXT, build_url TEXT
    );
  `);
  raw.exec(readFileSync("migrations/0027_operator_audit_events.sql", "utf8"));
  raw
    .prepare(
      "INSERT INTO site_publication (id,active_build_id,building_id,requested_id,requested_at) VALUES ('site',?,?,?,?)",
    )
    .run(buildId, requestId, requestId, "2026-11-07T00:00:00.000Z");
  raw
    .prepare(
      "INSERT INTO publication_builds (build_id,request_id,state,stage,stages,requested_at) VALUES (?,?,'building','web',?,?)",
    )
    .run(
      buildId,
      requestId,
      JSON.stringify({ web: { startedAt: "2026-11-07T00:00:00.000Z", state: "running" } }),
      "2026-11-07T00:00:00.000Z",
    );
  return { raw, db: fromNodeSqlite(raw) };
}

describe("publication audit completion", () => {
  it("records completion separately and atomically with the final publication state", async () => {
    const { raw, db } = publicationDb("build-success", "publish-success");
    await finishPublicationBuild(
      db,
      { buildId: "build-success", requestId: "publish-success" },
      "2026-11-07T00:05:00.000Z",
    );
    const event = raw
      .prepare(
        "SELECT request_id,actor_type,source,action,target_type,target_id,result,status_code,publication_id,metadata FROM operator_audit_events",
      )
      .get() as Record<string, unknown>;
    const publication = raw
      .prepare("SELECT state FROM publication_builds WHERE build_id='build-success'")
      .get() as { state: string };
    expect(publication.state).toBe("deployed");
    expect(event).toMatchObject({
      request_id: "publish-success",
      actor_type: "system",
      source: "system",
      action: "site.publication.completed",
      target_type: "publication",
      target_id: "publish-success",
      result: "succeeded",
      status_code: 200,
      publication_id: "publish-success",
    });
    expect(JSON.parse(String(event["metadata"]))).toMatchObject({ phase: "completion" });
  });

  it("records a failed build as a separate failed completion event", async () => {
    const { raw, db } = publicationDb("build-failed", "publish-failed");
    await finishPublicationBuild(
      db,
      { buildId: "build-failed", requestId: "publish-failed" },
      "2026-11-07T00:05:00.000Z",
      { code: "WEB_DEPLOY_FAILED", message: "secret-free test failure" },
    );
    const event = raw
      .prepare("SELECT action,result,status_code,metadata FROM operator_audit_events")
      .get() as Record<string, unknown>;
    const publication = raw
      .prepare("SELECT state FROM publication_builds WHERE build_id='build-failed'")
      .get() as { state: string };
    expect(publication.state).toBe("failed");
    expect(event).toMatchObject({
      action: "site.publication.failed",
      result: "failed",
      status_code: 500,
    });
    expect(String(event["metadata"])).not.toContain("secret-free test failure");
  });
});
