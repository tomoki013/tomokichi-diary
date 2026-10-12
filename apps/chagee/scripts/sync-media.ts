/**
 * media/*.jpg → WebP at 480 and 735 px wide → R2 `photos/<name>-<width>.webp`.
 * Usage: tsx scripts/sync-media.ts --local | --remote
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = `${root}.seed/photos`;
const BUCKET = "chagee-guide-media";
const WIDTHS = [480, 735];

await mkdir(out, { recursive: true });
const files = (await readdir(`${root}media`)).filter((f) => /\.(jpe?g|png)$/i.test(f));
for (const file of files) {
  const name = file.replace(/\.[^.]+$/, "");
  for (const width of WIDTHS) {
    const path = `${out}/${name}-${width}.webp`;
    await sharp(`${root}media/${file}`)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(path);
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "r2",
        "object",
        "put",
        `${BUCKET}/photos/${name}-${width}.webp`,
        "--file",
        path,
        "--content-type",
        "image/webp",
        target,
      ],
      { cwd: root, stdio: "inherit" },
    );
  }
}
console.log(`media: ${files.length} photos → ${BUCKET} (${target})`);
