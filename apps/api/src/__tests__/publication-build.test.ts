import { describe, expect, it } from "vitest";
import { fromNodeSqlite, openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import type { SqlDatabase } from "@tomokichi/infra-d1";
import { publicationStatus } from "../publication.js";
import { beginPublicationBuild } from "../../../../scripts/lib/publication-build.js";

const options = {
  force: true,
  requestId: "code-build",
  now: "2026-10-10T12:00:00Z",
  buildUrl: "https://github.com/tomoki013/tomokichi-diary/actions/runs/1",
};
async function database() {
  const db = fromNodeSqlite(openInMemoryDatabase());
  await db.exec(`CREATE TABLE site_publication (id TEXT PRIMARY KEY, requested_id TEXT, requested_at TEXT, building_id TEXT, deployed_id TEXT, deployed_at TEXT, failed_id TEXT, error TEXT, build_url TEXT);
    INSERT INTO site_publication (id) VALUES ('site');`);
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
