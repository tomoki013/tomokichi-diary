import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildKnowledgeCatalog } from "@tomokichi/application";
import { parseExportFiles } from "@tomokichi/data";

const root = process.cwd();
const exportDir = join(root, "export");
const snapshot = parseExportFiles((path) => {
  try {
    return readFileSync(join(exportDir, path), "utf8");
  } catch {
    return null;
  }
});
const output = join(exportDir, "knowledge", "catalog.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(buildKnowledgeCatalog(snapshot), null, 2)}\n`);
process.stdout.write(`✓ knowledge catalog ${buildKnowledgeCatalog(snapshot).length} articles\n`);
