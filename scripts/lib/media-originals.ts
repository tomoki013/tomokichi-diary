import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { ContentSnapshot } from "@tomokichi/data";
import { concurrent, downloadRemoteMedia } from "./media-remote.js";

export async function downloadOriginals(
  snapshot: ContentSnapshot,
  options: {
    mediaDir?: string;
    cacheDir?: string;
    download?: typeof downloadRemoteMedia;
  } = {},
) {
  const root = resolve(options.mediaDir ?? "media");
  let cached = 0;
  let downloaded = 0;
  await concurrent(snapshot.media, 4, async (asset) => {
    const path = resolve(root, asset.storageKey);
    if (!path.startsWith(root + sep)) throw new Error("Invalid media storage key");
    const hash = asset.contentSha256 ?? asset.sha256;
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid media content hash");
    const cache = resolve(options.cacheDir ?? ".cache/publication-originals", hash);
    const matches = (body: Buffer) => createHash("sha256").update(body).digest("hex") === hash;
    if (existsSync(path) && matches(readFileSync(path))) {
      cached++;
      return;
    }
    let body: Buffer | null = existsSync(cache) ? readFileSync(cache) : null;
    if (!body || !matches(body)) {
      body = await (options.download ?? downloadRemoteMedia)(asset.storageKey);
      if (!body || !matches(body)) throw new Error(`Missing or corrupt media: ${asset.storageKey}`);
      mkdirSync(dirname(cache), { recursive: true });
      writeFileSync(cache, body);
      downloaded++;
    } else cached++;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  });
  process.stdout.write(`Originals: ${cached} cached, ${downloaded} downloaded\n`);
  return { cached, downloaded };
}
