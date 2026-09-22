import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_DB_PATH, openLocalDatabase } from "./lib/local-db.js";

/**
 * Rebuilds the local authoring database from the committed export.
 *
 * `export/` is what the public site is built from and what the release seeds
 * into D1, so it — not whatever `.data/tomokichi.db` last held — is the state
 * an edit must start from. The previous database is kept beside the new one.
 *
 *   pnpm db:restore-local
 */
const SEED = join(process.cwd(), ".artifacts", "seed.sql");

execFileSync("pnpm", ["exec", "tsx", "scripts/seed-d1.ts"], { stdio: "inherit" });

if (existsSync(LOCAL_DB_PATH)) {
  const backup = `${LOCAL_DB_PATH}.${new Date().toISOString().replaceAll(":", "-")}.bak`;
  renameSync(LOCAL_DB_PATH, backup);
  process.stdout.write(`previous database kept at ${backup}\n`);
}

const { sqlite } = await openLocalDatabase();
sqlite.exec(readFileSync(SEED, "utf8"));
const articles = sqlite.prepare("SELECT COUNT(*) AS n FROM articles").get() as { n: number };
sqlite.close();

process.stdout.write(`✓ restored ${LOCAL_DB_PATH} from export | articles ${articles.n}\n`);
