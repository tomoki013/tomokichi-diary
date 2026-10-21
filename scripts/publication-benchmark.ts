/** Offline, isolated compute benchmark. NEVER dispatches Actions or calls Cloudflare. */
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildKnowledgeCatalog } from "@tomokichi/application";
import { buildExportFiles, type ContentSnapshot } from "@tomokichi/data";
import { loadSnapshot } from "./lib/built-site.js";
import { mcpFingerprint } from "./lib/publication-mcp.js";

const root = process.cwd();
const target = mkdtempSync(join(tmpdir(), "publication-benchmark-"));
const output = join(root, ".artifacts/publication-performance");
mkdirSync(output, { recursive: true });
const baselineRef =
  process.env.PUBLICATION_BASELINE_REF ?? "566844b1475750b9380c90672d4e5b7e30e783ea";
const baselineScript = execFileSync("git", ["show", `${baselineRef}:scripts/media-build.ts`], {
  encoding: "utf8",
});
const optimizedPackage = readFileSync(join(root, "package.json"), "utf8");
const optimizedScript = readFileSync(join(root, "scripts/media-build.ts"), "utf8");
const snapshot = loadSnapshot();
const links: [string, string][] = [];
const excluded = new Set(["node_modules", "dist", "ui-dist", ".astro", ".wrangler", ".cloudflare"]);
for (const name of [
  "apps",
  "packages",
  "infrastructure",
  "scripts",
  "media",
  "migration",
  "migrations",
]) {
  cpSync(join(root, name), join(target, name), {
    recursive: true,
    filter: (source, destination) => {
      if (basename(source) === "node_modules") {
        links.push([source, destination]);
        return false;
      }
      return (
        !excluded.has(basename(source)) &&
        !basename(source).startsWith(".env") &&
        !basename(source).startsWith(".dev.vars") &&
        !source.endsWith(".tsbuildinfo")
      );
    },
  });
}
for (const name of [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "mise.toml",
])
  cpSync(join(root, name), join(target, name));
links.push([join(root, "node_modules"), join(target, "node_modules")]);
for (const [source, destination] of links) symlinkSync(source, destination, "dir");
const env = {
  ...process.env,
  PUBLIC_SITE_URL: "https://tomokichidiary.com",
  PUBLIC_INDEXABLE: "true",
  ASTRO_TELEMETRY_DISABLED: "1",
  PUBLIC_BUILD_TIME: "2026-10-21T00:00:00Z",
};
for (const key of Object.keys(env))
  if (/^(CLOUDFLARE_|GITHUB_|MISE_GITHUB_TOKEN)/.test(key)) delete env[key as keyof typeof env];
interface Sample {
  scenario: string;
  mode: string;
  iteration: number;
  computeMs: number;
  mediaMs: number;
  buildMs: number;
  checksMs: number;
  mcpChanged: boolean;
  cached: number;
  total: number;
}
const samples: Sample[] = [];
async function command(label: string, args: string[]) {
  const start = performance.now();
  const result = await new Promise<{ code: number; log: string }>((resolve) => {
    const child = spawn("pnpm", args, { cwd: target, env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    child.once("error", (error) => resolve({ code: 1, log: String(error) }));
    child.once("close", (code) => resolve({ code: code ?? 1, log }));
  });
  writeFileSync(join(output, `${label}.log`), result.log);
  if (result.code) throw new Error(`${label} failed: ${result.log.slice(-1500)}`);
  return { ms: Math.round(performance.now() - start), log: result.log };
}
function writeSnapshot(value: ContentSnapshot) {
  rmSync(join(target, "export"), { recursive: true, force: true });
  for (const file of buildExportFiles(value)) {
    const path = join(target, "export", file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);
  }
  const path = join(target, "export/knowledge/catalog.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(buildKnowledgeCatalog(value)));
}
function resetCache() {
  const cache = join(target, ".cache/images");
  rmSync(cache, { recursive: true, force: true });
  cpSync(join(root, ".cache/images"), cache, { recursive: true });
}
try {
  // Same baseline content and cache for both modes. Builds stay in the temporary copy.
  writeSnapshot(snapshot);
  resetCache();
  const deployedMcp = mcpFingerprint(target);
  const image = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: "#4588a2" },
  })
    .png()
    .toBuffer();
  const hash = createHash("sha256").update(image).digest("hex");
  mkdirSync(join(target, "media/originals"), { recursive: true });
  writeFileSync(join(target, "media/originals/benchmark.png"), image);
  const articles = snapshot.articles
    .filter(
      (a) =>
        a.kind === "article" &&
        a.publishedRevisionId &&
        snapshot.articleMedia.some((m) => m.articleId === a.id),
    )
    .slice(0, 5);
  if (articles.length < 5 || !snapshot.media[0])
    throw new Error("Benchmark needs five published articles with media");
  const targetArticle = articles[0]!;
  const first = targetArticle.publishedRevisionId;
  const cases = ["A-text", "B-title-seo", "C-alt-caption", "D-new-image", "E-bulk"];
  for (const scenario of cases) {
    const revisionIds = new Set(
      scenario === "E-bulk" ? articles.map((a) => a.publishedRevisionId) : [first],
    );
    const changed: ContentSnapshot = {
      ...snapshot,
      revisions: snapshot.revisions.map((r) => {
        if (!revisionIds.has(r.id)) return r;
        if (scenario === "B-title-seo")
          return {
            ...r,
            title: `${r.title}・確認`,
            seoDescriptionOverride: `${r.summary ?? ""} 公開性能を確認するための説明文です。`,
          };
        if (scenario === "C-alt-caption") return r;
        return {
          ...r,
          bodyMarkdown: `${r.bodyMarkdown}\n\n公開性能の確認文です。${scenario === "D-new-image" ? "\n\n![確認画像](https://media.tomokichidiary.com/originals/benchmark.png)" : ""}`,
        };
      }),
      articleMedia:
        scenario === "C-alt-caption"
          ? snapshot.articleMedia.map((a) =>
              a.articleId === targetArticle.id
                ? {
                    ...a,
                    alt: `${a.alt}確認`,
                    caption: "確認キャプション",
                  }
                : a,
            )
          : snapshot.articleMedia,
      media:
        scenario === "D-new-image"
          ? [
              ...snapshot.media,
              {
                ...snapshot.media[0]!,
                id: "benchmark-image" as (typeof snapshot.media)[number]["id"],
                storageKey: "originals/benchmark.png",
                sha256: hash,
                contentSha256: hash,
                width: 1600,
                height: 1200,
                size: image.length,
                mimeType: "image/png",
              },
            ]
          : snapshot.media,
    };
    for (const mode of ["baseline", "optimized"]) {
      resetCache();
      const packageFile = JSON.parse(optimizedPackage);
      if (mode === "baseline")
        packageFile.scripts["content:check"] =
          "pnpm check:routes && pnpm check:seo && pnpm check:links && pnpm check:knowledge";
      writeFileSync(
        join(target, "package.json"),
        mode === "baseline" ? JSON.stringify(packageFile, null, 2) : optimizedPackage,
      );
      let lastMcp = deployedMcp;
      writeFileSync(
        join(target, "scripts/media-build.ts"),
        mode === "baseline" ? baselineScript : optimizedScript,
      );
      // Match the Actions bug: baseline always restores the immutable old cache;
      // optimized restores the previous execution's successfully expanded cache.
      for (let iteration = 1; iteration <= 3; iteration++) {
        if (mode === "baseline") resetCache();
        writeSnapshot({
          ...changed,
          revisions: changed.revisions.map((r) =>
            !revisionIds.has(r.id) || scenario === "C-alt-caption"
              ? r
              : scenario === "B-title-seo"
                ? { ...r, title: `${r.title}${iteration}` }
                : { ...r, bodyMarkdown: `${r.bodyMarkdown}\n\n比較用の変更 ${iteration}` },
          ),
          articleMedia:
            scenario === "C-alt-caption"
              ? changed.articleMedia.map((m) =>
                  m.articleId === targetArticle.id
                    ? { ...m, caption: `${m.caption} ${iteration}` }
                    : m,
                )
              : changed.articleMedia,
        });
        const prefix = `${scenario}-${mode}-${iteration}`;
        const start = performance.now();
        const media = await command(`${prefix}-media`, ["media:build"]);
        const fingerprint = mcpFingerprint(target);
        const mcpChanged = fingerprint !== lastMcp;
        const build = await command(
          `${prefix}-build`,
          mode === "baseline" ? ["build"] : ["--filter", "@tomokichi/web", "build"],
        );
        let mcpMs = 0;
        if (mode === "optimized" && mcpChanged)
          mcpMs = (
            await command(`${prefix}-mcp`, ["--filter", "@tomokichi/mcp-server", "build:content"])
          ).ms;
        const checks = await command(`${prefix}-checks`, ["content:check"]);
        const hit = /(\d+) derivatives \((\d+) cached\)/.exec(media.log);
        samples.push({
          scenario,
          mode,
          iteration,
          computeMs: Math.round(performance.now() - start),
          mediaMs: media.ms,
          buildMs: build.ms + mcpMs,
          checksMs: checks.ms,
          mcpChanged: mode === "baseline" || mcpChanged,
          cached: Number(hit?.[2] ?? 0),
          total: Number(hit?.[1] ?? 0),
        });
        lastMcp = fingerprint;
        writeFileSync(
          join(output, "local-benchmark.json"),
          JSON.stringify(
            {
              kind: "offline-compute-only",
              baselineRef,
              platform: `${process.platform}-${process.arch}`,
              node: process.version,
              snapshotArticles: snapshot.articles.length,
              targetArticles: articles.map((a) => ({ slug: a.slug, kind: a.kind })),
              productionDeploys: 0,
              samples,
            },
            null,
            2,
          ),
        );
        process.stdout.write(
          `${prefix}: ${samples.at(-1)!.computeMs}ms, images ${media.ms}ms, build ${build.ms + mcpMs}ms\n`,
        );
      }
    }
  }
} finally {
  rmSync(target, { recursive: true, force: true });
}
process.stdout.write(`Offline results: ${relative(root, output)}/local-benchmark.json\n`);
