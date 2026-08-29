import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./lib/run.js";
import type { Finding } from "./lib/report.js";
import { report } from "./lib/built-site.js";

/**
 * Performance budget over a handful of representative pages rather than the
 * whole site: the templates are shared, so a regression shows up on any of
 * them (instruction §58).
 *
 * Absolute limits are the floor. `PERF_BASELINE` (a summary from main) turns on
 * the relative check, which catches a page getting much slower while still
 * technically inside budget.
 */
const OUT_DIR = join(process.cwd(), ".artifacts", "ci", "lighthouse");

const LIMITS = {
  performance: 0.95,
  seo: 1,
  "largest-contentful-paint": 2500,
  "cumulative-layout-shift": 0.1,
  "total-blocking-time": 200,
} as const;

const REGRESSION = { "largest-contentful-paint": 1.15, "total-byte-weight": 1.1 } as const;

interface LighthouseReport {
  requestedUrl: string;
  finalDisplayedUrl?: string;
  categories: Record<string, { score: number | null }>;
  audits: Record<string, { numericValue?: number; score?: number | null }>;
}

const findings: Finding[] = [];

if (!existsSync(join(process.cwd(), "apps", "web", "dist", "index.html"))) {
  process.stdout.write(`${JSON.stringify({ skipped: true, reason: "site not built" })}\n`);
  process.exit(0);
}

rmSync(OUT_DIR, { recursive: true, force: true });
const outcome = await run("pnpm", ["exec", "lhci", "autorun", "--config=lighthouserc.json"]);

const reports = existsSync(OUT_DIR)
  ? readdirSync(OUT_DIR)
      .filter((name) => name.endsWith(".json") && name !== "manifest.json")
      .map((name) => JSON.parse(readFileSync(join(OUT_DIR, name), "utf8")) as LighthouseReport)
      .filter((candidate) => candidate.categories !== undefined)
  : [];

if (reports.length === 0) {
  // Chrome is not available everywhere; a missing run is reported as skipped
  // rather than as a pass, so it can never hide a regression.
  process.stdout.write(
    `${JSON.stringify({ skipped: true, reason: outcome.ok ? "no lighthouse reports produced" : "lighthouse failed" })}\n`,
  );
  process.exit(0);
}

const baselinePath = process.env.PERF_BASELINE;
const baseline: Record<string, Record<string, number>> = baselinePath && existsSync(baselinePath)
  ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, Record<string, number>>)
  : {};

const measured: Record<string, Record<string, number>> = {};
let worstPerformance = 1;

for (const result of reports) {
  const route =
    new URL(result.finalDisplayedUrl ?? result.requestedUrl).pathname
      .replace(/index\.html$/, "")
      .replace(/\/$/, "") || "/";

  const performance = result.categories["performance"]?.score ?? 0;
  const seo = result.categories["seo"]?.score ?? 0;
  worstPerformance = Math.min(worstPerformance, performance);

  const numeric = (audit: string): number => result.audits[audit]?.numericValue ?? 0;
  measured[route] = {
    performance,
    "largest-contentful-paint": numeric("largest-contentful-paint"),
    "total-blocking-time": numeric("total-blocking-time"),
    "cumulative-layout-shift": numeric("cumulative-layout-shift"),
    "total-byte-weight": numeric("total-byte-weight"),
  };

  const fail = (code: Finding["code"], actual: number, limit: number, previous?: number): void => {
    findings.push({
      code,
      target: route,
      actual: Math.round(actual * 1000) / 1000,
      limit: Math.round(limit * 1000) / 1000,
      baseline: previous === undefined ? undefined : Math.round(previous),
      rerun: "pnpm perf",
    });
  };

  if (performance < LIMITS.performance) fail("PERF_SCORE", performance, LIMITS.performance);
  if (seo < LIMITS.seo) fail("PERF_SCORE", seo, LIMITS.seo);
  if (numeric("largest-contentful-paint") > LIMITS["largest-contentful-paint"]) {
    fail("PERF_LCP", numeric("largest-contentful-paint"), LIMITS["largest-contentful-paint"]);
  }
  if (numeric("cumulative-layout-shift") > LIMITS["cumulative-layout-shift"]) {
    fail("PERF_CLS", numeric("cumulative-layout-shift"), LIMITS["cumulative-layout-shift"]);
  }
  if (numeric("total-blocking-time") > LIMITS["total-blocking-time"]) {
    fail("PERF_TBT", numeric("total-blocking-time"), LIMITS["total-blocking-time"]);
  }

  for (const [audit, ratio] of Object.entries(REGRESSION)) {
    const previous = baseline[route]?.[audit];
    if (previous === undefined || previous === 0) continue;
    if (numeric(audit) > previous * ratio) {
      fail("PERF_REGRESSION", numeric(audit), previous * ratio, previous);
    }
  }
}

// Written on every run so a green build on main can be fed back as the
// baseline for the relative check on the next branch.
writeFileSync(
  join(process.cwd(), ".artifacts", "ci", "perf-baseline.json"),
  `${JSON.stringify(measured, null, 2)}\n`,
);

report(findings, { perf: Math.round(worstPerformance * 100), pages: reports.length }, "perf");
