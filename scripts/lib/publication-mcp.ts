import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { SqlDatabase } from "@tomokichi/infra-d1";
import type { PublicationBuild } from "./publication-build.js";

/** Actual embedded catalog plus every possible workspace/config input to the MCP bundle.
 * Conservative source coverage also catches code changes between content-only releases.
 */
export function mcpFingerprint(root = process.cwd()): string {
  const hash = createHash("sha256").update(`mcp-v1:${process.version}`);
  const excluded = new Set([
    "node_modules",
    "dist",
    "ui-dist",
    ".astro",
    ".wrangler",
    ".cloudflare",
  ]);
  function visit(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (excluded.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile())
        hash.update(relative(root, file)).update("\0").update(readFileSync(file)).update("\0");
    }
  }
  for (const path of ["apps/mcp-server", "packages", "infrastructure"]) visit(join(root, path));
  for (const path of [
    "export/knowledge/catalog.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "tsconfig.base.json",
    "mise.toml",
  ]) {
    if (existsSync(join(root, path)))
      hash
        .update(path)
        .update("\0")
        .update(readFileSync(join(root, path)))
        .update("\0");
  }
  return hash.digest("hex");
}

export async function needsMcpDeploy(db: SqlDatabase, fingerprint: string) {
  const previous = await db
    .prepare("SELECT fingerprint FROM publication_targets WHERE target = 'mcp'")
    .first<{ fingerprint: string }>();
  return previous?.fingerprint !== fingerprint;
}

/** Called only AFTER cf deploy succeeds. Cache restores never certify a deployment. */
export async function recordMcpDeploy(
  db: SqlDatabase,
  build: PublicationBuild,
  fingerprint: string,
  now: string,
) {
  await db
    .prepare(
      `INSERT INTO publication_targets (target, fingerprint, deployed_at)
    SELECT 'mcp', ?, ? WHERE EXISTS (SELECT 1 FROM site_publication WHERE active_build_id = ? AND building_id = ?)
    ON CONFLICT(target) DO UPDATE SET fingerprint = excluded.fingerprint, deployed_at = excluded.deployed_at`,
    )
    .bind(fingerprint, now, build.buildId, build.requestId)
    .run();
}
