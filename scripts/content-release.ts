import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  loadContentSnapshot,
  publishDueArticles,
  silentLogger,
  systemClock,
  uuidV7Generator,
} from "@tomokichi/application";
import { buildExportFiles, type ContentSnapshot } from "@tomokichi/data";
import { createRepositories } from "@tomokichi/infra-d1";
import { createMemoryStorage, createMediaUrlResolver } from "@tomokichi/infra-r2";
import { remoteDatabase } from "./lib/remote-db.js";
import { beginPublicationBuild } from "./lib/publication-build.js";
const db = remoteDatabase();
const releaseFile = join(process.cwd(), ".artifacts/content-release.json");
const command = process.argv[2];
if (command === "due") {
  const count = await publishDueArticles(context());
  if (count > 0)
    await db
      .prepare(
        "UPDATE site_publication SET requested_id = ?, requested_at = ?, failed_id = NULL, error = NULL WHERE id = 'site'",
      )
      .bind(crypto.randomUUID(), new Date().toISOString())
      .run();
  process.stdout.write(`Published ${count} due articles\n`);
} else if (command === "pull") {
  const requestId = await beginPublicationBuild(db, {
    force: process.argv.includes("--force"),
    requestId: crypto.randomUUID(),
    now: new Date().toISOString(),
    buildUrl: process.env.GITHUB_RUN_ID
      ? `https://github.com/tomoki013/tomokichi-diary/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
  });
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${Boolean(requestId)}\n`);
  if (!requestId) {
    process.stdout.write("Content is already deployed\n");
    process.exit(0);
  }
  mkdirSync(dirname(releaseFile), { recursive: true });
  writeFileSync(releaseFile, JSON.stringify({ requestId }));
  const snapshot = await loadContentSnapshot(context());
  const files = buildExportFiles(snapshot);
  const exportDir = join(process.cwd(), "export");
  rmSync(exportDir, { recursive: true, force: true });
  for (const file of files) {
    const path = join(exportDir, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);
  }
  writeFileSync(
    join(exportDir, "knowledge/catalog.json"),
    JSON.stringify((await import("@tomokichi/application")).buildKnowledgeCatalog(snapshot)),
  );
  await downloadOriginals(snapshot);
  process.stdout.write(`Pulled ${snapshot.articles.length} articles from D1\n`);
} else if (command === "complete" || command === "fail") {
  if (!existsSync(releaseFile)) process.exit(0);
  const { requestId } = JSON.parse(readFileSync(releaseFile, "utf8")) as { requestId: string };
  if (command === "complete")
    await db
      .prepare(
        "UPDATE site_publication SET deployed_id = ?, deployed_at = ?, building_id = CASE WHEN building_id = ? THEN NULL ELSE building_id END, failed_id = CASE WHEN failed_id = ? THEN NULL ELSE failed_id END, error = CASE WHEN failed_id = ? THEN NULL ELSE error END WHERE id = 'site'",
      )
      .bind(requestId, new Date().toISOString(), requestId, requestId, requestId)
      .run();
  else
    await db
      .prepare(
        "UPDATE site_publication SET failed_id = ?, error = ?, building_id = NULL WHERE id = 'site' AND building_id = ?",
      )
      .bind(
        requestId,
        "サイトの生成または配信に失敗しました。実行ログを確認して再試行してください",
        requestId,
      )
      .run();
  process.stdout.write(`Publication ${command} recorded\n`);
} else throw new Error("Usage: content-release.ts due | pull [--force] | complete | fail");

function context() {
  return {
    repos: createRepositories(db),
    clock: systemClock,
    ids: uuidV7Generator,
    logger: silentLogger,
    storage: createMemoryStorage(),
    mediaUrls: createMediaUrlResolver("https://media.tomokichidiary.com"),
    ai: null,
  };
}

async function downloadOriginals(snapshot: ContentSnapshot) {
  const root = resolve("media");
  // Bounded downloads, and checksums before an uploaded original enters a build.
  const queue = [...snapshot.media];
  const worker = async () => {
    for (let asset = queue.shift(); asset; asset = queue.shift()) {
      const path = resolve(root, asset.storageKey);
      if (!path.startsWith(root + sep)) throw new Error("Invalid media storage key");
      if (existsSync(path)) continue;
      const response = await fetch(`https://media.tomokichidiary.com/${asset.storageKey}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Missing media: ${asset.storageKey}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(body).digest("hex") !== asset.sha256)
        throw new Error(`Media checksum mismatch: ${asset.storageKey}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}
