import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import {
  backfillMediaHashes,
  recoverMediaUploads,
  silentLogger,
  systemClock,
  uuidV7Generator,
  type AppContext,
} from "@tomokichi/application";
import { createRepositories } from "@tomokichi/infra-d1";
import { fromNodeSqlite } from "@tomokichi/infra-d1/testing";
import { createMediaUrlResolver } from "@tomokichi/infra-r2";
import { remoteDatabase } from "./lib/remote-db.js";
import { LOCAL_DB_PATH } from "./lib/local-db.js";

const args = new Set(process.argv.slice(2));
for (const arg of args)
  if (!["--apply", "--remote", "--verify-all", "--recover", "--uploads-paused"].includes(arg))
    throw new Error(`Unknown option: ${arg}`);
const apply = args.has("--apply");
if (apply && !args.has("--uploads-paused"))
  throw new Error("Pause uploads before applying, then pass --uploads-paused");
const remote = args.has("--remote");
const sqlite = remote ? null : new DatabaseSync(LOCAL_DB_PATH, { readOnly: !apply });
sqlite?.exec("PRAGMA foreign_keys = ON");
const db = remote ? remoteDatabase() : fromNodeSqlite(sqlite!);
const root = resolve("media");
const ctx: AppContext = {
  repos: createRepositories(db),
  clock: systemClock,
  ids: uuidV7Generator,
  logger: silentLogger,
  mediaUrls: createMediaUrlResolver("https://media.tomokichidiary.com"),
  ai: null,
  storage: {
    get: async (key) => {
      let path: string;
      if (remote) {
        const account = process.env.CLOUDFLARE_ACCOUNT_ID;
        const token = process.env.CLOUDFLARE_API_TOKEN;
        if (!account || !token) throw new Error("Cloudflare maintenance credentials are required");
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/r2/buckets/${encodeURIComponent(process.env.MEDIA_BUCKET ?? "tomokichi-diary-media")}/objects/${key.split("/").map(encodeURIComponent).join("/")}`,
          {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(60_000),
          },
        );
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`R2 original fetch failed (HTTP ${response.status})`);
        const body = await response.arrayBuffer();
        return {
          body,
          mimeType: response.headers.get("content-type") ?? "application/octet-stream",
          size: body.byteLength,
        };
      } else {
        path = resolve(root, key);
        if (!path.startsWith(`${root}${sep}`)) throw new Error("invalid storage key");
      }
      const bytes = await readFile(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!bytes) return null;
      return {
        body: Uint8Array.from(bytes).buffer,
        mimeType: "application/octet-stream",
        size: bytes.length,
      };
    },
    put: async () => {
      throw new Error("Maintenance never writes objects");
    },
    delete: async () => {
      throw new Error("Maintenance never deletes objects");
    },
    exists: async () => {
      throw new Error("Use get for verified original reads");
    },
  },
};
try {
  const report = args.has("--recover")
    ? await recoverMediaUploads(ctx, apply)
    : await backfillMediaHashes(ctx, {
        apply,
        verifyAll: args.has("--verify-all"),
        onProgress: (processed, total) => {
          if (processed % 20 === 0 || processed === total)
            process.stdout.write(`Processed originals: ${processed}/${total}\n`);
        },
      });
  await mkdir(".artifacts", { recursive: true });
  const file = resolve(
    ".artifacts",
    `media-${args.has("--recover") ? "recovery" : "backfill"}-${remote ? "remote" : "local"}-${Date.now()}.json`,
  );
  let status;
  let statusError: string | undefined;
  try {
    status = await ctx.repos.media.hashStatus();
  } catch (error) {
    statusError = error instanceof Error ? error.message : "status unavailable";
    process.exitCode = 1;
  }
  await writeFile(
    file,
    `${JSON.stringify({ apply, remote, report, status, statusError }, null, 2)}\n`,
  );
  process.stdout.write(
    `${apply ? "Applied" : "Dry run"}: ${report.length} images; report ${basename(file)}\n`,
  );
  if (
    report.some(
      (item) =>
        item.state === "skipped" || item.state.includes("failed") || item.state.includes("invalid"),
    )
  )
    process.exitCode = 1;
} finally {
  sqlite?.close();
}
