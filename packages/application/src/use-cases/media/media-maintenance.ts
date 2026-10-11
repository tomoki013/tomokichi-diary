import type { AppContext } from "../../context.js";
import { inspectImage, sha256Hex } from "./image-content.js";

export interface MediaHashReport {
  mediaId: string;
  storageKey: string;
  state: "verified" | "duplicate" | "skipped";
  sha256?: string;
  canonicalId?: string;
  legacyHashMismatch?: boolean;
  reason?: string;
}

/** Registers original-byte hashes without modifying legacy identities or URLs. */
export async function backfillMediaHashes(
  ctx: AppContext,
  options: { apply: boolean; verifyAll?: boolean },
): Promise<MediaHashReport[]> {
  const assets = (await ctx.repos.media.listAll()).toSorted(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const report: MediaHashReport[] = [];
  const canonical = new Map(
    (await ctx.repos.media.listHashes()).map((entry) => [entry.sha256, entry.mediaId]),
  );
  for (const asset of assets) {
    if (asset.contentSha256 && !options.verifyAll) {
      canonical.set(asset.contentSha256, canonical.get(asset.contentSha256) ?? asset.id);
      continue;
    }
    const base = { mediaId: asset.id, storageKey: asset.storageKey };
    try {
      const original = await ctx.storage.get(asset.storageKey);
      if (!original) {
        report.push({ ...base, state: "skipped", reason: "original missing" });
        continue;
      }
      const sha256 = await sha256Hex(original.body);
      const representative = options.apply
        ? (await ctx.repos.media.registerHash(asset.id, sha256)).id
        : (canonical.get(sha256) ?? asset.id);
      canonical.set(sha256, representative);
      report.push({
        ...base,
        state: representative === asset.id ? "verified" : "duplicate",
        sha256,
        canonicalId: representative,
        legacyHashMismatch: sha256 !== asset.sha256,
      });
    } catch (error) {
      report.push({
        ...base,
        state: "skipped",
        reason: error instanceof Error ? error.message : "read or registration failed",
      });
    }
  }
  return report;
}

/** Only run with uploads paused: no lease stealing and no storage deletion. */
export async function recoverMediaUploads(
  ctx: AppContext,
  apply: boolean,
): Promise<{ mediaId: string; state: string }[]> {
  const report: { mediaId: string; state: string }[] = [];
  for (const asset of await ctx.repos.media.listPendingUploads()) {
    try {
      if (Date.parse(asset.createdAt) > Date.parse(ctx.clock.now()) - 15 * 60_000) {
        report.push({ mediaId: asset.id, state: "recent-reservation-skipped" });
        continue;
      }
      const existing = await ctx.repos.media.findBySha256(asset.sha256);
      if (existing) {
        if (apply) await ctx.repos.media.releaseUpload(asset.sha256, asset.id);
        report.push({ mediaId: asset.id, state: "already-completed" });
        continue;
      }
      const object = await ctx.storage.get(asset.storageKey);
      if (!object) {
        if (apply) await ctx.repos.media.releaseUpload(asset.sha256, asset.id);
        report.push({ mediaId: asset.id, state: "empty-reservation-released" });
        continue;
      }
      if (!inspectImage(object.body) || (await sha256Hex(object.body)) !== asset.sha256) {
        report.push({ mediaId: asset.id, state: "invalid-object-kept-for-investigation" });
        continue;
      }
      if (apply) await ctx.repos.media.completeUpload(asset);
      report.push({ mediaId: asset.id, state: "completed" });
    } catch {
      report.push({ mediaId: asset.id, state: "failed-reservation-kept" });
    }
  }
  return report;
}
