import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseExportFiles, type ContentSnapshot } from "@tomokichi/data";
import { normalizeRoutePath } from "@tomokichi/domain";

export const DIST_DIR = join(process.cwd(), "apps", "web", "dist");
const EXPORT_DIR = join(process.cwd(), "export");

export function loadSnapshot(): ContentSnapshot {
  return parseExportFiles((path) => {
    const file = join(EXPORT_DIR, path);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  });
}

export interface BuiltPage {
  /** Site path, e.g. `/posts/chagee-menu-explained`. */
  path: string;
  file: string;
}

/** Every generated HTML document, keyed the same way routes are. */
export function listBuiltPages(dir = DIST_DIR): BuiltPage[] {
  if (!existsSync(dir)) return [];
  const pages: BuiltPage[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".html")) continue;
      const relativePath = relative(dir, full).split(sep).join("/");
      pages.push({
        // `about.html` and `about/index.html` both address `/about`.
        path: normalizeRoutePath(`/${relativePath.replace(/(?:(?:^|\/)index)?\.html$/, "")}`),
        file: full,
      });
    }
  };

  walk(dir);
  return pages;
}

export function readBuiltPage(page: BuiltPage): string {
  return readFileSync(page.file, "utf8");
}

export function loadLegacyBaseline<T>(name: string): T[] {
  const file = join(process.cwd(), "migration", name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T[]) : [];
}

/** Emits the one-line JSON payload the CI runner reads, or a readable report. */
export function report(
  findings: readonly { code: string; target?: string; message?: string }[],
  metrics: Record<string, string | number>,
  label: string,
): never {
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ findings, metrics })}\n`);
  } else if (findings.length === 0) {
    process.stdout.write(
      `✓ ${label} ${Object.entries(metrics)
        .map(([k, v]) => `${k} ${v}`)
        .join(" | ")}\n`,
    );
  } else {
    for (const finding of findings.slice(0, 40)) {
      process.stdout.write(`${finding.code} ${finding.target ?? ""}\n  ${finding.message ?? ""}\n`);
    }
    if (findings.length > 40) process.stdout.write(`… and ${findings.length - 40} more\n`);
  }
  process.exit(findings.length > 0 ? 1 : 0);
}
