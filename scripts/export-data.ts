import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadContentSnapshot } from "@tomokichi/application";
import { buildExportFiles } from "@tomokichi/data";
import { createLocalContext } from "./lib/local-db.js";

/**
 * Writes the whole content graph as Markdown + JSON. The result is committed,
 * so the public site can be rebuilt from the repository alone and the content
 * survives the database it happens to live in (instruction §53).
 */
const outDir = join(process.cwd(), "export");

const ctx = await createLocalContext();
const snapshot = await loadContentSnapshot(ctx);
const files = buildExportFiles(snapshot);

rmSync(outDir, { recursive: true, force: true });
for (const file of files) {
  const path = join(outDir, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.contents);
}

process.stdout.write(
  `✓ export ${files.length} files | articles ${snapshot.articles.length} | routes ${snapshot.routes.length} | media ${snapshot.media.length}\n`,
);
