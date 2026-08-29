import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../migrator.js";
import { fromNodeSqlite, openInMemoryDatabase } from "../node-sqlite.js";
import { createRepositories } from "../repositories.js";
import { loadMigrations } from "./context.js";

/**
 * The committed export must be able to rebuild the database from nothing.
 * Backup is only real if the restore path is exercised (instruction §74).
 */
describe("restore from export", () => {
  it("loads the generated seed into an empty schema", async () => {
    const seedPath = join(process.cwd(), ".artifacts", "seed.sql");
    if (!existsSync(seedPath)) {
      execFileSync("pnpm", ["exec", "tsx", "scripts/seed-d1.ts"], { stdio: "ignore" });
    }

    const sqlite = openInMemoryDatabase();
    const db = fromNodeSqlite(sqlite);
    await migrate(db, loadMigrations());
    sqlite.exec(readFileSync(seedPath, "utf8"));

    const repos = createRepositories(db);
    const articles = await repos.articles.listAll();
    const routes = await repos.routes.listAll();
    const exported = JSON.parse(
      readFileSync(join(process.cwd(), "export", "articles.json"), "utf8"),
    ) as unknown[];

    expect(articles).toHaveLength(exported.length);
    expect(routes.length).toBeGreaterThan(articles.length);

    // A round-tripped article keeps the pointers that decide what is public.
    const published = articles.find((article) => article.status === "published");
    expect(published?.publishedRevisionId).toBeTruthy();
    expect(await repos.revisions.findById(published!.publishedRevisionId!)).not.toBeNull();
  });
});
