import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentIndex } from "@tomokichi/application";
import { parseExportFiles } from "@tomokichi/data";
import { instantFrom } from "@tomokichi/domain";

const EXPORT_DIR = join(process.cwd(), "..", "..", "export");

/**
 * The content graph, read once per build. `PUBLIC_BUILD_TIME` pins "now" so a
 * rebuild of the same commit produces byte-identical output.
 */
function read(path: string): string | null {
  try {
    return readFileSync(join(EXPORT_DIR, path), "utf8");
  } catch {
    return null;
  }
}

const snapshot = parseExportFiles(read);
const now = instantFrom(process.env.PUBLIC_BUILD_TIME ?? Date.now());

export const content = new ContentIndex(snapshot, now);
export { snapshot, now };
