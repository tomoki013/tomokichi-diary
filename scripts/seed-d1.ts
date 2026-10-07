import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSnapshot } from "./lib/built-site.js";
import { buildSeedStatements } from "./lib/seed-sql.js";

/**
 * Turns the committed export into SQL, so a database can be filled -- or an
 * existing one brought up to the export -- from the repository alone. The
 * statements upsert (see `lib/seed-sql.ts`), so rows the export does not carry,
 * such as reader likes and contact messages, are left alone.
 *
 * `seed.sql` is the plain script (the restore test loads it); `seed.batch.json`
 * is the same statements as one D1 batch, which runs as a single transaction:
 *
 *   pnpm seed:sql
 *   cf d1 raw <database-id> --batch @.artifacts/seed.batch.json   (pnpm db:seed)
 */
const OUT = join(process.cwd(), ".artifacts", "seed.sql");
const BATCH = join(process.cwd(), ".artifacts", "seed.batch.json");

const snapshot = loadSnapshot();
const statements = buildSeedStatements(snapshot);
const sql = statements.join("\n");

// `.artifacts/` is generated and gitignored, so on a clean checkout — CI, or
// anyone's first run — the directory this writes into does not exist yet.
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${sql}\n`);
writeFileSync(BATCH, JSON.stringify(statements.map((statement) => ({ sql: statement }))));
process.stdout.write(
  `✓ seed ${OUT} | articles ${snapshot.articles.length} | routes ${snapshot.routes.length} | media ${snapshot.media.length}\n`,
);
