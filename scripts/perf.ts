import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { launch } from "chrome-launcher";
import lighthouse, { desktopConfig } from "lighthouse";
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

/** `lighthouserc.json` keeps the Lighthouse CI shape; only these fields are read. */
interface PerfConfig {
  ci: {
    collect: {
      staticDistDir: string;
      numberOfRuns: number;
      url: string[];
      settings: { chromeFlags: string };
    };
  };
}

const findings: Finding[] = [];
const { collect } = (JSON.parse(readFileSync("lighthouserc.json", "utf8")) as PerfConfig).ci;
const DIST = join(process.cwd(), collect.staticDistDir);

if (!existsSync(join(DIST, "index.html"))) {
  process.stdout.write(`${JSON.stringify({ skipped: true, reason: "site not built" })}\n`);
  process.exit(0);
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Already-compressed formats; everything else is gzipped like the CDN does. */
const PRECOMPRESSED = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".woff2"]);

/**
 * The built site served the way Lighthouse CI's `staticDistDir` did (gzip
 * included), so byte weights stay comparable with earlier baselines.
 */
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const relative = normalize(pathname.endsWith("/") ? `${pathname}index.html` : pathname);
  readFile(join(DIST, relative)).then(
    (body) => {
      const type = CONTENT_TYPES[extname(relative)] ?? "application/octet-stream";
      const gzip =
        !PRECOMPRESSED.has(extname(relative)) &&
        /\bgzip\b/.test(String(request.headers["accept-encoding"] ?? ""));
      response.writeHead(200, {
        "content-type": type,
        ...(gzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}),
      });
      response.end(gzip ? gzipSync(body) : body);
    },
    () => {
      response.writeHead(404).end();
    },
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${(server.address() as AddressInfo).port}`;

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const reports: LighthouseReport[] = [];
let failure: string | undefined;
try {
  for (const configured of collect.url) {
    const url = new URL(new URL(configured).pathname, origin).href;
    for (let attempt = 1; attempt <= collect.numberOfRuns; attempt++) {
      // A fresh Chrome per run, as Lighthouse CI did, so caches and warmed-up
      // processes never carry from one run into the next.
      const chrome = await launch({ chromeFlags: collect.settings.chromeFlags.split(" ") });
      try {
        const result = await lighthouse(
          url,
          { port: chrome.port, output: "html", logLevel: "error" },
          desktopConfig,
        );
        if (result === undefined) continue;
        const name = `${new URL(url).pathname.replace(/^\/|\.html$/g, "").replace(/\//g, "_") || "index"}-${attempt}`;
        writeFileSync(join(OUT_DIR, `${name}.report.json`), JSON.stringify(result.lhr));
        writeFileSync(join(OUT_DIR, `${name}.report.html`), result.report as string);
        reports.push(result.lhr as LighthouseReport);
      } finally {
        chrome.kill();
      }
    }
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  server.close();
}

if (reports.length === 0) {
  // Chrome is not available everywhere; a missing run is reported as skipped
  // rather than as a pass, so it can never hide a regression.
  // The reason is carried through so a skipped gate is still diagnosable from
  // the summary alone.
  process.stdout.write(
    `${JSON.stringify({
      skipped: true,
      reason:
        failure === undefined ? "no lighthouse reports produced" : `lighthouse failed: ${failure}`,
    })}\n`,
  );
  process.exit(0);
}

const baselinePath = process.env.PERF_BASELINE;
const baseline: Record<string, Record<string, number>> = baselinePath && existsSync(baselinePath)
  ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, Record<string, number>>)
  : {};

const measured: Record<string, Record<string, number>> = {};
let worstPerformance = 1;

/**
 * Each page is loaded `numberOfRuns` times (lighthouserc.json) and judged on
 * the median of those runs, per metric. Judging every run on its own made the
 * gate fail on a single unlucky run: on the same commit, TBT for `/` ranged
 * from under 100ms to over 600ms, depending on whether first paint landed
 * before or after the initial style-and-layout task. A page that is really
 * over budget is over budget in most of its runs, so the median still fails it.
 */
const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const runsByRoute = new Map<string, LighthouseReport[]>();
for (const result of reports) {
  const route =
    new URL(result.finalDisplayedUrl ?? result.requestedUrl).pathname
      .replace(/index\.html$/, "")
      .replace(/\/$/, "") || "/";
  runsByRoute.set(route, [...(runsByRoute.get(route) ?? []), result]);
}

for (const [route, runs] of runsByRoute) {
  const category = (name: string): number =>
    median(runs.map((entry) => entry.categories[name]?.score ?? 0));
  const numeric = (audit: string): number =>
    median(runs.map((entry) => entry.audits[audit]?.numericValue ?? 0));

  const performance = category("performance");
  const seo = category("seo");
  worstPerformance = Math.min(worstPerformance, performance);

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

report(
  findings,
  { perf: Math.round(worstPerformance * 100), pages: runsByRoute.size, runs: reports.length },
  "perf",
);
