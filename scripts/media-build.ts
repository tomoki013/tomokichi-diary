import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { loadSnapshot } from "./lib/built-site.js";
import type { ContentSnapshot } from "@tomokichi/data";
import {
  concurrent,
  downloadRemoteMedia,
  downloadDerivative,
  listRemoteMedia,
  matchesRemote,
  type RemoteMediaObject,
} from "./lib/media-remote.js";

/**
 * Builds the responsive derivatives that the site references.
 *
 * They are content-addressed build artifacts, cached between runs and never
 * committed: the originals under `media/` remain the only source of truth
 * (instruction §18, §26, §93).
 */
export const MEDIA_DIR = join(process.cwd(), "media");
export const CACHE_DIR = join(process.cwd(), ".cache", "images");

const FORMATS = ["avif", "webp"] as const;
type Format = (typeof FORMATS)[number];

const QUALITY: Record<Format, number> = { avif: 58, webp: 74 };
const LADDER = [340, 704, 1408];
const CONCURRENCY = 8;

export function widthsFor(intrinsicWidth: number | null): number[] {
  if (intrinsicWidth === null || intrinsicWidth <= 0) return [...LADDER];
  return [
    ...new Set([
      ...LADDER.filter((width) => width < intrinsicWidth),
      Math.min(intrinsicWidth, LADDER.at(-1)!),
    ]),
  ].toSorted((a, b) => a - b);
}

export interface Derivative {
  key: string;
  file: string;
  source: string;
  width: number;
  format: Format;
}

export function plannedDerivatives(snapshot: ContentSnapshot = loadSnapshot()): Derivative[] {
  const plans = snapshot.media
    .filter((asset) => asset.mimeType.startsWith("image/") && asset.mimeType !== "image/svg+xml")
    .flatMap((asset) =>
      widthsFor(asset.width).flatMap((width) =>
        FORMATS.map((format) => {
          const key = `_img/${asset.sha256.slice(0, 16)}-${width}.${format}`;
          return {
            key,
            file: join(CACHE_DIR, key.slice("_img/".length)),
            source: join(MEDIA_DIR, asset.storageKey),
            width,
            format,
          };
        }),
      ),
    );
  return [...new Map(plans.map((job) => [job.key, job])).values()];
}

async function encode(job: Derivative): Promise<void> {
  mkdirSync(dirname(job.file), { recursive: true });
  await sharp(job.source)
    .resize({ width: job.width, withoutEnlargement: true })
    .toFormat(job.format, { quality: QUALITY[job.format] })
    .toFile(job.file);
}

async function valid(job: Derivative) {
  try {
    const metadata = await sharp(job.file).metadata();
    return (
      metadata.width !== undefined &&
      metadata.width > 0 &&
      metadata.width <= job.width &&
      (job.format === "avif" ? metadata.format === "heif" : metadata.format === "webp")
    );
  } catch {
    return false;
  }
}

export async function buildMedia(
  jobs = plannedDerivatives(),
  options: {
    remote?: boolean;
    full?: boolean;
    inventory?: () => Promise<Map<string, RemoteMediaObject>>;
    download?: typeof downloadRemoteMedia;
  } = {},
) {
  const inventory =
    options.remote && !options.full ? await (options.inventory ?? listRemoteMedia)() : new Map();
  let cached = 0;
  let restored = 0;
  let generated = 0;
  const failures: string[] = [];
  await concurrent(jobs, CONCURRENCY, async (job) => {
    try {
      const object = inventory.get(job.key);
      if (
        !options.full &&
        existsSync(job.file) &&
        (await valid(job)) &&
        (!object || matchesRemote(readFileSync(job.file), object))
      ) {
        cached++;
        return;
      }
      if (object) {
        const body = options.download
          ? await options.download(job.key)
          : await downloadDerivative(object);
        if (body && matchesRemote(body, object)) {
          mkdirSync(dirname(job.file), { recursive: true });
          writeFileSync(job.file, body);
          if (await valid(job)) {
            restored++;
            return;
          }
        }
      }
      await encode(job);
      generated++;
    } catch (error) {
      failures.push(`${job.source}: ${String(error)}`);
    }
  });

  const bytes = jobs
    .filter((job) => existsSync(job.file))
    .reduce((sum, job) => sum + statSync(job.file).size, 0);
  const originals = jobs
    .map((job) => job.source)
    .filter((source, index, all) => all.indexOf(source) === index && existsSync(source))
    .reduce((sum, source) => sum + statSync(source).size, 0);

  process.stdout.write(
    `✓ media ${jobs.length} derivatives (${cached} cached) | ${restored} restored | ${generated} generated | hit rate ${jobs.length ? (((cached + restored) / jobs.length) * 100).toFixed(1) : 100}% | ${(bytes / 1024 / 1024).toFixed(1)}MB from ${(originals / 1024 / 1024).toFixed(1)}MB of originals\n`,
  );
  for (const failure of failures.slice(0, 5)) process.stdout.write(`  ${failure}\n`);
  if (failures.length) throw new Error(`${failures.length} media derivatives failed`);
  return { total: jobs.length, cached, restored, generated };
}

if (process.argv[1]?.endsWith("media-build.ts") === true) {
  const metrics = await buildMedia(undefined, {
    remote: process.env.MEDIA_BUILD_REMOTE === "1",
    full: process.env.MEDIA_BUILD_FULL === "1",
  });
  mkdirSync(".artifacts", { recursive: true });
  writeFileSync(".artifacts/media-build.json", JSON.stringify(metrics));
}
