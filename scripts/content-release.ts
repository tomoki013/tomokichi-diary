import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  loadContentSnapshot,
  publishDueArticles,
  silentLogger,
  systemClock,
  uuidV7Generator,
  buildKnowledgeCatalog,
} from "@tomokichi/application";
import { buildExportFiles } from "@tomokichi/data";
import {
  publicationStages,
  type PublicationStage,
  type PublicationStageResult,
} from "@tomokichi/contracts";
import { createRepositories } from "@tomokichi/infra-d1";
import { createMemoryStorage, createMediaUrlResolver } from "@tomokichi/infra-r2";
import { remoteDatabase } from "./lib/remote-db.js";
import {
  beginPublicationBuild,
  finishPublicationBuild,
  progressPublicationBuild,
  type PublicationBuild,
} from "./lib/publication-build.js";
import { mcpFingerprint, needsMcpDeploy, recordMcpDeploy } from "./lib/publication-mcp.js";
import { downloadOriginals } from "./lib/media-originals.js";
import { timed } from "./lib/publication-timing.js";
import { verifyPublication } from "./lib/publication-verify.js";

const db = remoteDatabase();
const releaseFile = join(process.cwd(), ".artifacts/content-release.json");
interface Release extends PublicationBuild {
  snapshotHash: string;
  mcpHash: string;
  requestedAt?: string;
  startedAt?: string;
  verifiedAt?: string;
}
const readRelease = () => JSON.parse(readFileSync(releaseFile, "utf8")) as Release;
const saveRelease = (release: Release) => writeFileSync(releaseFile, JSON.stringify(release));
const now = () => new Date().toISOString();
const output = (name: string, value: string) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
const command = process.argv[2];
if (command === "due") {
  const count = await timed("scheduled-publication", () => publishDueArticles(context()));
  if (count > 0)
    await db
      .prepare(
        "UPDATE site_publication SET requested_id = ?, requested_at = ?, failed_id = NULL, error = NULL WHERE id = 'site'",
      )
      .bind(crypto.randomUUID(), now())
      .run();
  process.stdout.write(`Published ${count} due articles\n`);
} else if (command === "pull") {
  const buildId = crypto.randomUUID();
  const requestId = await beginPublicationBuild(db, {
    force: process.argv.includes("--force"),
    requestId: crypto.randomUUID(),
    buildId,
    now: now(),
    buildUrl: process.env.GITHUB_RUN_ID
      ? `https://github.com/tomoki013/tomokichi-diary/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
  });
  output("changed", String(Boolean(requestId)));
  if (!requestId) {
    process.stdout.write("Content is already deployed\n");
    process.exit(0);
  }
  mkdirSync(dirname(releaseFile), { recursive: true });
  // Persist before pulling so a failed snapshot/download belongs to this execution.
  const release: Release = { requestId, buildId, snapshotHash: "", mcpHash: "" };
  saveRelease(release);
  const timing = await db
    .prepare("SELECT requested_at, started_at FROM publication_builds WHERE build_id = ?")
    .bind(buildId)
    .first<{ requested_at: string; started_at: string }>();
  release.requestedAt = timing?.requested_at;
  release.startedAt = timing?.started_at;
  saveRelease(release);
  const snapshot = await timed("d1-snapshot", () => loadContentSnapshot(context()));
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
    JSON.stringify(buildKnowledgeCatalog(snapshot)),
  );
  release.snapshotHash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  release.mcpHash = mcpFingerprint();
  saveRelease(release);
  output("mcp_changed", String(await needsMcpDeploy(db, release.mcpHash)));
  output(
    "media_key",
    createHash("sha256")
      .update(
        JSON.stringify(
          snapshot.media.map((a) => [a.sha256, a.contentSha256, a.width, a.mimeType]).toSorted(),
        ),
      )
      .digest("hex"),
  );
  await timed("r2-originals", () => downloadOriginals(snapshot));
  await progressPublicationBuild(db, release, "data", "completed", now());
  process.stdout.write(`Pulled ${snapshot.articles.length} articles from D1\n`);
} else if (command === "progress") {
  if (!existsSync(releaseFile)) process.exit(0);
  const stage = process.argv[3] as PublicationStage;
  const state = process.argv[4] as PublicationStageResult["state"];
  if (
    !publicationStages.includes(stage) ||
    !["running", "completed", "skipped", "failed"].includes(state)
  )
    throw new Error("Invalid publication progress");
  await progressPublicationBuild(db, readRelease(), stage, state, now());
} else if (command === "mcp-deployed") {
  const release = readRelease();
  await recordMcpDeploy(db, release, release.mcpHash, now());
} else if (command === "marker") {
  const release = readRelease();
  const root = join(process.cwd(), "apps/web/dist");
  mkdirSync(join(root, "__publication"), { recursive: true });
  writeFileSync(
    join(root, "__publication", `${release.buildId}.json`),
    JSON.stringify({
      requestId: release.requestId,
      buildId: release.buildId,
      snapshotHash: release.snapshotHash,
    }),
  );
  appendFileSync(
    join(root, "_headers"),
    "\n/__publication/*\n  X-Robots-Tag: noindex\n  Cache-Control: no-store\n",
  );
} else if (command === "verify") {
  const release = readRelease();
  await timed("live-confirmation", () =>
    verifyPublication(release, process.env.VERIFY_URL ?? "https://tomokichidiary.com"),
  );
  release.verifiedAt = now();
  saveRelease(release);
} else if (command === "complete" || command === "fail") {
  if (!existsSync(releaseFile)) process.exit(0);
  const release = readRelease();
  if (command === "complete" && !release.verifiedAt)
    throw new Error("Live publication has not been verified");
  const failureFile = ".artifacts/publication-failure.json";
  const failure = existsSync(failureFile)
    ? (JSON.parse(readFileSync(failureFile, "utf8")) as { name: string })
    : null;
  const failureLabels: Record<string, string> = {
    pull: "公開データの取得",
    images: "画像処理",
    "web-build": "サイト生成",
    "mcp-build": "MCP生成",
    checks: "公開前チェック",
    "r2-sync": "画像の同期",
    "mcp-deploy": "MCP配信",
    "web-deploy": "サイト配信",
    verify: "反映確認",
    complete: "公開完了の記録",
  };
  await timed("record-publication", () =>
    finishPublicationBuild(
      db,
      release,
      now(),
      command === "fail"
        ? {
            code: failure
              ? `STEP_${failure.name.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`
              : "WORKFLOW_FAILED",
            message: `サイトの公開処理に失敗しました${failure ? `（${failureLabels[failure.name] ?? "公開処理"}）` : ""}。実行ログを確認して再試行してください。`,
          }
        : undefined,
    ),
  );
  process.stdout.write(`Publication ${command} recorded\n`);
} else
  throw new Error(
    "Usage: content-release.ts due | pull [--force] | progress <stage> <state> | marker | verify | mcp-deployed | complete | fail",
  );

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
