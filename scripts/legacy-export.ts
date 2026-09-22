import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSnapshot } from "./lib/built-site.js";
import { LEGACY_REPO } from "./lib/legacy-source.js";
import { buildLegacyPosts } from "./legacy-sync/export-legacy.js";

/**
 * Temporary, until the cutover (scripts/legacy-sync/README.md).
 *
 * One-way: writes the committed 2.0 export into the legacy repository's
 * `posts/` and copies any image the legacy site does not have yet. Run it
 * after `pnpm export:data`, then commit and push the legacy repository so
 * both sites publish the same content.
 *
 *   pnpm legacy:export            write
 *   pnpm legacy:export --check    report what would change, exit 1 if anything
 */
const POSTS_DIR = join(LEGACY_REPO, "posts");
const LEGACY_PUBLIC = join(LEGACY_REPO, "public");
const MEDIA_DIR = join(process.cwd(), "media");

if (!existsSync(POSTS_DIR)) {
  process.stderr.write(`legacy repository not found at ${LEGACY_REPO} (set LEGACY_REPO)\n`);
  process.exit(2);
}

const checkOnly = process.argv.includes("--check");
const snapshot = loadSnapshot();
const posts = buildLegacyPosts(snapshot, (slug) => {
  const file = join(POSTS_DIR, `${slug}.md`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
});

let written = 0;
let copied = 0;
const missingImages: string[] = [];

for (const post of posts) {
  if (post.changed) {
    written++;
    if (!checkOnly) writeFileSync(join(POSTS_DIR, `${post.slug}.md`), post.contents);
    process.stdout.write(`${checkOnly ? "would write" : "wrote"} posts/${post.slug}.md\n`);
  }
  for (const imagePath of post.imagePaths) {
    const key = imagePath.replace(/^\/+/, "");
    const destination = join(LEGACY_PUBLIC, key);
    if (existsSync(destination)) continue;
    const source = join(MEDIA_DIR, key);
    if (!existsSync(source)) {
      missingImages.push(`${post.slug}: ${imagePath}`);
      continue;
    }
    copied++;
    if (!checkOnly) {
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    process.stdout.write(`${checkOnly ? "would copy" : "copied"} public/${key}\n`);
  }
}

for (const missing of missingImages) process.stderr.write(`image missing in media/: ${missing}\n`);

process.stdout.write(
  `${checkOnly ? "–" : "✓"} legacy export | posts ${posts.length} | ${checkOnly ? "pending" : "written"} ${written} | images ${copied}\n`,
);
process.exit(missingImages.length > 0 || (checkOnly && (written > 0 || copied > 0)) ? 1 : 0);
