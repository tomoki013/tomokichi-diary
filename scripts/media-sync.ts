import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./lib/run.js";
import { MEDIA_DIR, plannedDerivatives } from "./media-build.js";
import { loadSnapshot } from "./lib/built-site.js";
import {
  concurrent,
  listRemoteMedia,
  matchesRemote,
  md5,
  type RemoteMediaObject,
} from "./lib/media-remote.js";

const BUCKET = process.env.MEDIA_BUCKET ?? "tomokichi-diary-media";
const MANIFEST = join(process.cwd(), ".cache", "r2-manifest.json");
const WRANGLER = join(process.cwd(), "apps", "api", "node_modules", ".bin", "wrangler");
export interface Upload {
  key: string;
  file: string;
}
export function cacheControlFor(key: string): string {
  return key.startsWith("_img/") ? "public, max-age=31536000, immutable" : "public, max-age=604800";
}
export function requiresUpload(
  body: Buffer,
  key: string,
  object: RemoteMediaObject | undefined,
  full = false,
) {
  return full || !matchesRemote(body, object, cacheControlFor(key));
}

export async function syncMedia(
  all: Upload[],
  options: {
    full?: boolean;
    inventory?: () => Promise<Map<string, RemoteMediaObject>>;
    upload?: (upload: Upload) => Promise<void>;
    manifestPath?: string;
  } = {},
) {
  // A cache manifest is only a diagnostic. Always verify the current bucket,
  // including on cache hits and after partial uploads/deletions outside CI.
  const inventory = options.inventory ?? listRemoteMedia;
  const remote = await inventory();
  const pending = all.filter((upload) =>
    requiresUpload(readFileSync(upload.file), upload.key, remote.get(upload.key), options.full),
  );
  const manifest: Record<string, string> = {};
  const save = () => {
    const path = options.manifestPath ?? MANIFEST;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(manifest));
  };
  let uploaded = 0;
  const failures: string[] = [];
  const upload =
    options.upload ??
    (async (item: Upload) => {
      const outcome = await run(WRANGLER, [
        "r2",
        "object",
        "put",
        `${BUCKET}/${item.key}`,
        `--file=${item.file}`,
        `--cache-control=${cacheControlFor(item.key)}`,
        "--remote",
      ]);
      if (!outcome.ok) throw new Error(`R2 upload failed: ${item.key}`);
    });
  await concurrent(pending, Number(process.env.MEDIA_SYNC_CONCURRENCY ?? 6), async (item) => {
    try {
      await upload(item);
      manifest[item.key] = `${md5(readFileSync(item.file))}:${cacheControlFor(item.key)}`;
      uploaded++;
      if (uploaded % 25 === 0) save();
    } catch (error) {
      failures.push(String(error));
    }
  });
  save();
  if (failures.length) throw new Error(failures.slice(0, 10).join("\n"));
  // A successful CLI exit alone is insufficient. Re-read origin metadata after writes.
  const verified = pending.length ? await inventory() : remote;
  for (const item of all) {
    if (!matchesRemote(readFileSync(item.file), verified.get(item.key), cacheControlFor(item.key)))
      throw new Error(`R2 verification failed: ${item.key}`);
  }
  const metrics = { total: all.length, uploaded, unchanged: all.length - pending.length };
  process.stdout.write(
    `✓ media sync ${uploaded}/${pending.length} uploaded | ${metrics.unchanged} unchanged | origin verified ${all.length} | bucket ${BUCKET}\n`,
  );
  return metrics;
}

if (process.argv[1]?.endsWith("media-sync.ts") === true) {
  const snapshot = loadSnapshot();
  const all = [
    ...snapshot.media.map((asset) => ({
      key: asset.storageKey,
      file: join(MEDIA_DIR, asset.storageKey),
    })),
    ...plannedDerivatives(snapshot).map((job) => ({ key: job.key, file: job.file })),
  ];
  for (const upload of all)
    if (!existsSync(upload.file)) throw new Error(`Missing media: ${upload.key}`);
  const metrics = await syncMedia(all, { full: process.env.MEDIA_SYNC_FULL === "1" });
  mkdirSync(".artifacts", { recursive: true });
  writeFileSync(".artifacts/media-sync.json", JSON.stringify(metrics));
}
