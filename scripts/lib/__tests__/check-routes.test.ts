import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../check-routes.ts", import.meta.url));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function runCheck({ publishedPage = true, legacyDraft = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tomokichi-public-routes-"));
  dirs.push(dir);
  for (const path of ["export", "migration", "apps/web/dist/posts"])
    mkdirSync(join(dir, path), { recursive: true });
  const json = (path: string, value: unknown) =>
    writeFileSync(join(dir, path), JSON.stringify(value));
  json("export/articles.json", [
    {
      id: "published",
      kind: "article",
      status: "published",
      publishedRevisionId: "revision",
      publishedAt: "2026-10-16T00:00:00.000Z",
    },
    { id: "draft", kind: "article", status: "draft", publishedRevisionId: null },
  ]);
  json("export/revisions.json", [{ id: "revision", articleId: "published" }]);
  json(
    "export/routes.json",
    ["published", "draft"].map((id) => ({
      id: `route-${id}`,
      path: `/posts/${id}`,
      targetType: "article",
      targetId: id,
      isCanonical: true,
      redirectTo: null,
      locale: "ja",
    })),
  );
  json("migration/legacy-routes.json", legacyDraft ? [{ path: "/posts/draft" }] : []);
  if (publishedPage)
    writeFileSync(join(dir, "apps/web/dist/posts/published.html"), "<!doctype html>");
  const result = spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), SCRIPT, "--json"],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, PUBLIC_BUILD_TIME: "2026-10-17T10:00:00.000Z" },
    },
  );
  if (!result.stdout) throw new Error(result.stderr || String(result.error));
  return { status: result.status, ...JSON.parse(result.stdout) } as {
    status: number;
    findings: { code: string; target: string }[];
    metrics: { routes: string };
  };
}

describe("check:routes against a public snapshot containing reserved draft URLs", () => {
  it("accepts the built published page without requiring an HTML file for the draft", () => {
    const result = runCheck();
    expect(result.status).toBe(0);
    expect(result.findings).toEqual([]);
  });
  it("still rejects a missing published page", () => {
    const result = runCheck({ publishedPage: false });
    expect(result.status).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "ROUTE_TARGET_MISSING", target: "/posts/published" }),
    );
  });
  it("still requires every legacy URL to resolve to a built page", () => {
    const result = runCheck({ legacyDraft: true });
    expect(result.status).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "ROUTE_LEGACY_MISSING", target: "/posts/draft" }),
    );
    expect(result.metrics.routes).toBe("0/1");
  });
});
