import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSnapshot } from "./lib/built-site.js";
import { buildSeedSql } from "./lib/seed-sql.js";

/**
 * Turns the committed export into SQL, so a database can be filled -- or an
 * existing one brought up to the export -- from the repository alone. The
 * statements upsert (see `lib/seed-sql.ts`), so rows the export does not carry,
 * such as reader likes and contact messages, are left alone.
 *
 *   pnpm exec tsx scripts/seed-d1.ts
 *   wrangler d1 execute tomokichi-diary --remote --file=.artifacts/seed.sql
 */
const OUT = join(process.cwd(), ".artifacts", "seed.sql");

const snapshot = loadSnapshot();
const sql = buildSeedSql(snapshot);

// `.artifacts/` is generated and gitignored, so on a clean checkout — CI, or
// anyone's first run — the directory this writes into does not exist yet.
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${sql}\n`);
process.stdout.write(
  `✓ seed ${OUT} | articles ${snapshot.articles.length} | routes ${snapshot.routes.length} | media ${snapshot.media.length}\n`,
);
