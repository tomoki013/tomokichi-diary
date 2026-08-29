import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Small context snapshot, so an agent (or a human) can understand the state of
 * the system without reading the repository or the CI logs.
 */
interface Diagnostics {
  runtime: { node: string; pnpm: string };
  schema: { latestMigration: string | null; count: number };
  content: {
    articles: number | null;
    published: number | null;
    routes: number | null;
    media: number | null;
  };
  ci: { status: string; finishedChecks: number; failedChecks: number } | null;
}

function version(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function migrations(): Diagnostics["schema"] {
  const dir = join(process.cwd(), "migrations");
  if (!existsSync(dir)) return { latestMigration: null, count: 0 };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  return { latestMigration: files.at(-1) ?? null, count: files.length };
}

/** Counts come from the vendor-neutral export, so diagnostics never needs a live database. */
function content(): Diagnostics["content"] {
  const dir = join(process.cwd(), "export");
  const read = <T>(name: string): T | null => {
    const path = join(dir, name);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
  };
  const articles = read<{ status: string }[]>("articles.json");
  const routes = read<unknown[]>("routes.json");
  const media = read<unknown[]>("media.json");
  return {
    articles: articles?.length ?? null,
    published: articles?.filter((a) => a.status === "published").length ?? null,
    routes: routes?.length ?? null,
    media: media?.length ?? null,
  };
}

function ci(): Diagnostics["ci"] {
  const path = join(process.cwd(), ".artifacts", "ci", "summary.json");
  if (!existsSync(path)) return null;
  const summary = JSON.parse(readFileSync(path, "utf8")) as {
    status: string;
    checks: unknown[];
    failedChecks: unknown[];
  };
  return {
    status: summary.status,
    finishedChecks: summary.checks.length,
    failedChecks: summary.failedChecks.length,
  };
}

const diagnostics: Diagnostics = {
  runtime: { node: process.version, pnpm: version("pnpm", ["--version"]) },
  schema: migrations(),
  content: content(),
  ci: ci(),
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
} else {
  const { runtime, schema, content: c, ci: ciResult } = diagnostics;
  const lines = [
    "Tomokichi Diary diagnostics",
    "",
    `runtime:   node ${runtime.node} / pnpm ${runtime.pnpm}`,
    `schema:    ${schema.latestMigration ?? "(none)"} (${schema.count} migrations)`,
    `articles:  ${c.articles ?? "-"} (published ${c.published ?? "-"})`,
    `routes:    ${c.routes ?? "-"}`,
    `media:     ${c.media ?? "-"}`,
    `ci:        ${ciResult ? `${ciResult.status} (${ciResult.failedChecks} failing)` : "(no run recorded)"}`,
    "",
    ciResult?.status === "failed" ? "✗ see .artifacts/ci/summary.json" : "✓ healthy",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
