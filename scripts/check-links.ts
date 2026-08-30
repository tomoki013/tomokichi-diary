import { existsSync } from "node:fs";
import { join } from "node:path";
import { RouteTable, normalizeRoutePath } from "@tomokichi/domain";
import type { Finding } from "./lib/report.js";
import { DIST_DIR, listBuiltPages, loadSnapshot, readBuiltPage, report } from "./lib/built-site.js";

/**
 * Every internal link and image in the generated site must resolve to
 * something that was actually built — a broken internal link is both a reader
 * problem and a crawl-budget problem (instruction §38).
 */
const snapshot = loadSnapshot();
const table = new RouteTable(snapshot.routes);
const pages = listBuiltPages();
const built = new Set(pages.map((page) => page.path));
const findings: Finding[] = [];

const assetExists = (path: string): boolean =>
  path.startsWith("/") && existsSync(join(DIST_DIR, decodeURIComponent(path).replace(/^\/+/, "")));

const MEDIA_DIR = join(process.cwd(), "media");
const DERIVATIVE_DIR = join(process.cwd(), ".cache", "images");

/**
 * Resolves a media URL back to the file the sync step uploads. Matching on the
 * path rather than on the origin keeps the check correct whichever media host
 * a build was configured with.
 */
const mediaExists = (url: string): boolean => {
  let path: string;
  try {
    path = url.startsWith("http") ? new URL(url).pathname : url;
  } catch {
    return false;
  }
  const key = decodeURIComponent(path.replace(/^\/+/, ""));
  if (key.startsWith("_img/")) return existsSync(join(DERIVATIVE_DIR, key.slice("_img/".length)));
  return key.startsWith("images/") && existsSync(join(MEDIA_DIR, key));
};

let checkedLinks = 0;
let checkedImages = 0;

for (const page of pages) {
  const html = readBuiltPage(page);

  const hrefs = new Set(
    [...html.matchAll(/<a\b[^>]+href="(\/[^"]*)"/gi)]
      .map((match) => match[1]!)
      .filter((href) => !href.startsWith("//")),
  );
  for (const href of hrefs) {
    checkedLinks++;
    const [pathOnly] = href.split("#");
    const path = normalizeRoutePath(pathOnly ?? "/");
    if (built.has(path) || table.resolve(path).ok || assetExists(path)) continue;
    findings.push({
      code: "LINK_INTERNAL_BROKEN",
      target: `${page.path} → ${href}`,
      message: "link target was not generated",
      rerun: "pnpm check:links",
    });
  }

  // Images are served from object storage, so the check verifies that the
  // bytes exist locally before they are ever uploaded.
  const sources = new Set([
    ...[...html.matchAll(/<img\b[^>]+src="([^"]*)"/gi)].map((match) => match[1]!),
    ...[...html.matchAll(/srcset="([^"]*)"/gi)].flatMap((match) =>
      match[1]!.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? ""),
    ),
  ]);
  for (const src of sources) {
    if (src === "") continue;
    checkedImages++;
    if (mediaExists(src) || assetExists(src)) continue;
    findings.push({
      code: "LINK_INTERNAL_BROKEN",
      target: `${page.path} → ${src}`,
      message: "image file is missing",
      rerun: "pnpm check:links",
    });
  }
}

report(findings, { links: checkedLinks, images: checkedImages }, "links");
