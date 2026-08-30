import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { run } from "./lib/run.js";
import { CACHE_DIR, MEDIA_DIR } from "./media-build.js";

/**
 * Uploads originals and derivatives to the media bucket.
 *
 * Uploads are tracked in a local manifest keyed by object key and size, so a
 * re-run only sends what changed. Nothing here holds a credential: it drives
 * the already-authenticated wrangler CLI.
 *
 *   pnpm media:build && pnpm media:sync
 */
const BUCKET = process.env.MEDIA_BUCKET ?? "tomokichi-diary-media";
const MANIFEST = join(process.cwd(), ".cache", "r2-manifest.json");
const WRANGLER = join(process.cwd(), "apps", "api", "node_modules", ".bin", "wrangler");
const CONCURRENCY = 12;

interface Upload {
  key: string;
  file: string;
  size: number;
}

function walk(dir: string, prefix: string): Upload[] {
  if (!existsSync(dir)) return [];
  const out: Upload[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry.startsWith(".")) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      out.push({
        key: `${prefix}${relative(dir, full).split(sep).join("/")}`,
        file: full,
        size: statSync(full).size,
      });
    }
  };
  visit(dir);
  return out;
}

const manifest: Record<string, number> = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, number>)
  : {};

const all = [...walk(MEDIA_DIR, ""), ...walk(CACHE_DIR, "_img/")];
const pending = all.filter((upload) => manifest[upload.key] !== upload.size);

const failures: string[] = [];
let done = 0;
const queue = [...pending];

const worker = async (): Promise<void> => {
  for (let upload = queue.shift(); upload !== undefined; upload = queue.shift()) {
    const outcome = await run(WRANGLER, [
      "r2",
      "object",
      "put",
      `${BUCKET}/${upload.key}`,
      `--file=${upload.file}`,
      "--remote",
    ]);
    if (outcome.ok) {
      manifest[upload.key] = upload.size;
      done++;
      if (done % 100 === 0) {
        mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
        writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 0)}\n`);
        process.stderr.write(`  ${done}/${pending.length}\n`);
      }
    } else {
      failures.push(`${upload.key}: ${outcome.output.trim().split("\n").at(-1) ?? "failed"}`);
    }
  }
};

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 0)}\n`);

process.stdout.write(
  `✓ media sync ${done}/${pending.length} uploaded | ${all.length - pending.length} unchanged | bucket ${BUCKET}\n`,
);
for (const failure of failures.slice(0, 10)) process.stdout.write(`  ✗ ${failure}\n`);
process.exit(failures.length > 0 ? 1 : 0);
