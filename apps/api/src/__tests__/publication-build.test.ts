import { describe, expect, it } from "vitest";
import { fromNodeSqlite, openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import { migrate } from "@tomokichi/infra-d1";
import { loadMigrations } from "@tomokichi/infra-d1/testing-context";
import type { SqlDatabase } from "@tomokichi/infra-d1";
import { publicationStatus } from "../publication.js";
import { needsMcpDeploy, recordMcpDeploy } from "../../../../scripts/lib/publication-mcp.js";
import {
  beginPublicationBuild,
  progressPublicationBuild,
  finishPublicationBuild,
} from "../../../../scripts/lib/publication-build.js";

const options = {
  force: true,
  requestId: "code-build",
  now: "2026-10-10T12:00:00Z",
  buildUrl: "https://github.com/tomoki013/tomokichi-diary/actions/runs/1",
};
async function database() {
  const db = fromNodeSqlite(openInMemoryDatabase());
  await migrate(db, loadMigrations());
  return db;
}
describe("publication build state", () => {
  it("shows an initial code release as building and exposes a failure with retry", async () => {
    const db = await database();
    expect(await beginPublicationBuild(db, options)).toBe("code-build");
    expect((await publicationStatus(db, true)).state).toBe("building");
    await db.exec(
      "UPDATE site_publication SET failed_id=building_id, error='build failed', building_id=NULL",
    );
    expect(await publicationStatus(db, true)).toMatchObject({
      state: "failed",
      error: "build failed",
    });
  });
  it("uses a new request for a code release even when the content is already deployed", async () => {
    const db = await database();
    await db.exec("UPDATE site_publication SET requested_id='old',deployed_id='old'");
    expect(await beginPublicationBuild(db, { ...options, force: false })).toBeNull();
    expect(await beginPublicationBuild(db, options)).toBe("code-build");
    expect((await publicationStatus(db, true)).state).toBe("building");
  });
  it("preserves an editor request that arrives while the code release starts", async () => {
    const db = await database();
    const interleaved: SqlDatabase = {
      ...db,
      prepare(sql) {
        const statement = db.prepare(sql);
        if (!sql.startsWith("UPDATE site_publication")) return statement;
        return {
          ...statement,
          bind(...params) {
            const bound = statement.bind(...params);
            return {
              ...bound,
              async run() {
                await db.exec(
                  "UPDATE site_publication SET requested_id='new-edit',requested_at='2026-10-10T12:01:00Z'",
                );
                return bound.run();
              },
            };
          },
        };
      },
    };
    expect(await beginPublicationBuild(interleaved, options)).toBe("code-build");
    expect(
      await db
        .prepare("SELECT requested_id,requested_at,building_id FROM site_publication")
        .first(),
    ).toEqual({
      requested_id: "new-edit",
      requested_at: "2026-10-10T12:01:00Z",
      building_id: "code-build",
    });
    expect((await publicationStatus(db, true)).state).toBe("queued");
  });
});

describe("publication progress fencing and recovery", () => {
  const first = { requestId: "code-build", buildId: "execution-1" };
  const started = "2026-10-10T12:00:00.000Z";
  const later = "2026-10-10T12:00:42.000Z";
  async function begin(db: SqlDatabase, buildId = first.buildId) {
    return beginPublicationBuild(db, { ...options, now: started, buildId });
  }
  it("reports real stages and preserves request wait time", async () => {
    const db = await database();
    await db.exec(
      "UPDATE site_publication SET requested_id='code-build', requested_at='2026-10-10T11:59:30.000Z'",
    );
    await begin(db);
    await progressPublicationBuild(db, first, "data", "completed", started);
    await progressPublicationBuild(db, first, "images", "skipped", started);
    await progressPublicationBuild(db, first, "site", "running", started);
    expect(await publicationStatus(db, true)).toMatchObject({
      requestId: first.requestId,
      buildId: first.buildId,
      stage: "site",
      requestedAt: "2026-10-10T11:59:30.000Z",
      stages: { images: { state: "skipped" } },
    });
    await progressPublicationBuild(db, first, "verify", "completed", later);
    await finishPublicationBuild(db, first, later);
    const status = await publicationStatus(db, true);
    expect(status).toMatchObject({ state: "deployed", deployedAt: later, errorCode: null });
    expect(status.durationMs).toBeCloseTo(72000, -1);
  });
  it.each(["another-article", "same-article-revision-2", "bulk-final-request", "due-schedule"])(
    "keeps %s pending when an earlier build completes",
    async (newRequest) => {
      const db = await database();
      await begin(db);
      await db
        .prepare("UPDATE site_publication SET requested_id=?, requested_at=?")
        .bind(newRequest, later)
        .run();
      await progressPublicationBuild(db, first, "deploy", "running", later);
      expect(await publicationStatus(db, true)).toMatchObject({
        state: "queued",
        requestId: newRequest,
        buildId: null,
        stage: null,
        buildUrl: null,
        stages: {},
      });
      await finishPublicationBuild(db, first, later);
      expect((await publicationStatus(db, true)).state).toBe("queued");
      expect(
        await beginPublicationBuild(db, {
          ...options,
          force: false,
          buildId: "execution-2",
          now: later,
        }),
      ).toBe(newRequest);
      await finishPublicationBuild(db, { requestId: newRequest, buildId: "execution-2" }, later);
      expect((await publicationStatus(db, true)).state).toBe("deployed");
    },
  );
  it("rejects late progress, completion, failure and MCP markers from a previous execution of the same request", async () => {
    const db = await database();
    await begin(db);
    await begin(db, "execution-2");
    await progressPublicationBuild(
      db,
      { ...first, buildId: "execution-2" },
      "checks",
      "running",
      later,
    );
    await progressPublicationBuild(db, first, "deploy", "running", later);
    await finishPublicationBuild(db, first, later);
    await finishPublicationBuild(db, first, later, { code: "OLD", message: "old failure" });
    await recordMcpDeploy(db, first, "old-hash", later);
    expect(await publicationStatus(db, true)).toMatchObject({
      state: "building",
      buildId: "execution-2",
      stage: "checks",
      error: null,
    });
    expect(await needsMcpDeploy(db, "old-hash")).toBe(true);
  });
  it("exposes the failing stage and retries without losing the last delivered version", async () => {
    const db = await database();
    await db.exec(
      "UPDATE site_publication SET deployed_id='previous',deployed_at='2026-10-09T00:00:00Z'",
    );
    await begin(db);
    await progressPublicationBuild(db, first, "deploy", "running", started);
    await finishPublicationBuild(db, first, later, {
      code: "STEP_WEB_DEPLOY",
      message: "Cloudflare deployment failed",
    });
    expect(await publicationStatus(db, true)).toMatchObject({
      state: "failed",
      stage: "deploy",
      errorCode: "STEP_WEB_DEPLOY",
      deployedAt: "2026-10-09T00:00:00Z",
      stages: { deploy: { state: "failed" } },
    });
    await begin(db, "retry");
    expect(await publicationStatus(db, true)).toMatchObject({
      state: "building",
      error: null,
      errorCode: null,
      buildId: "retry",
    });
    await recordMcpDeploy(db, { ...first, buildId: "retry" }, "actual-deployed-inputs", later);
    expect(await needsMcpDeploy(db, "actual-deployed-inputs")).toBe(false);
    expect(await needsMcpDeploy(db, "changed-catalog")).toBe(true);
  });
  it("does not regress the live version when an old job finishes after a newer completed build", async () => {
    const db = await database();
    await begin(db);
    await db.exec("UPDATE site_publication SET requested_id='new-request'");
    await begin(db, "execution-2");
    await finishPublicationBuild(db, { requestId: "new-request", buildId: "execution-2" }, later);
    await finishPublicationBuild(db, first, "2026-10-10T13:00:00Z");
    expect(await publicationStatus(db, true)).toMatchObject({
      requestId: "new-request",
      state: "deployed",
      deployedAt: later,
    });
  });
});
