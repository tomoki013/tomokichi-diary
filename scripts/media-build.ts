import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { loadSnapshot } from "./lib/built-site.js";

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

export function plannedDerivatives(): Derivative[] {
  return loadSnapshot()
    .media.filter(
      (asset) => asset.mimeType.startsWith("image/") && asset.mimeType !== "image/svg+xml",
    )
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
}

async function encode(job: Derivative): Promise<void> {
  mkdirSync(dirname(job.file), { recursive: true });
  await sharp(job.source)
    .resize({ width: job.width, withoutEnlargement: true })
    .toFormat(job.format, { quality: QUALITY[job.format] })
    .toFile(job.file);
}

if (process.argv[1]?.endsWith("media-build.ts") === true) {
  const jobs = plannedDerivatives().filter((job) => existsSync(job.source));
  const missing = plannedDerivatives().length - jobs.length;

  const queue = jobs.filter((job) => !existsSync(job.file));
  const cached = jobs.length - queue.length;
  const failures: string[] = [];

  const worker = async (): Promise<void> => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      try {
        await encode(job);
      } catch (error) {
        // A single unreadable original must not fail the build; it simply
        // keeps serving without derivatives.
        failures.push(`${job.source}: ${String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const bytes = jobs
    .filter((job) => existsSync(job.file))
    .reduce((sum, job) => sum + statSync(job.file).size, 0);
  const originals = plannedDerivatives()
    .map((job) => job.source)
    .filter((source, index, all) => all.indexOf(source) === index && existsSync(source))
    .reduce((sum, source) => sum + statSync(source).size, 0);

  process.stdout.write(
    `✓ media ${jobs.length} derivatives (${cached} cached) | ${(bytes / 1024 / 1024).toFixed(1)}MB from ${(originals / 1024 / 1024).toFixed(1)}MB of originals\n`,
  );
  if (missing > 0) process.stdout.write(`  ${missing} derivative(s) skipped: source missing\n`);
  for (const failure of failures.slice(0, 5)) process.stdout.write(`  ${failure}\n`);
}
