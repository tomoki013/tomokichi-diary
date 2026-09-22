import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSnapshot, report } from "./lib/built-site.js";
import { LEGACY_REPO, readLegacyPosts } from "./lib/legacy-source.js";
import { compareArticles, summarize } from "./legacy-sync/compare.js";
import { normalizeLegacyPosts, normalizeSnapshot } from "./legacy-sync/normalized-article.js";
import { renderParityReport } from "./legacy-sync/report.js";

/**
 * Temporary, until the cutover (scripts/legacy-sync/README.md).
 *
 * Both sites are reduced to NormalizedArticle records and compared field by
 * field. Any difference is a CONTENT_PARITY_MISMATCH: the fix is either
 * `pnpm legacy:export` (2.0 changed, legacy not yet regenerated) or
 * `pnpm content:revise` (someone edited the legacy repository directly).
 *
 *   pnpm content:parity            check, print mismatches
 *   pnpm content:parity --report   also rewrite docs/migration/content-parity-report.md
 */
const REPORT_PATH = join(process.cwd(), "docs", "migration", "content-parity-report.md");

if (!existsSync(join(LEGACY_REPO, "posts"))) {
  const message = `legacy repository not found at ${LEGACY_REPO} (set LEGACY_REPO); parity check skipped`;
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ findings: [], metrics: {}, skipped: true })}\n`);
  } else {
    process.stdout.write(`– ${message}\n`);
  }
  process.exit(0);
}

const snapshot = loadSnapshot();
const entries = compareArticles(
  normalizeSnapshot(snapshot),
  normalizeLegacyPosts(readLegacyPosts(), snapshot.routes),
);

if (process.argv.includes("--report")) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(
    REPORT_PATH,
    renderParityReport(entries, {
      generatedAt: new Date().toLocaleDateString("sv-SE"),
      legacyRepo: LEGACY_REPO.replace(`${dirname(process.cwd())}/`, "../"),
    }),
  );
}

const findings = entries
  .filter((entry) => entry.status !== "MATCHED")
  .map((entry) => ({
    code: "CONTENT_PARITY_MISMATCH" as const,
    target: entry.url,
    message:
      entry.status === "CONFLICT"
        ? `differs in ${entry.differences.map((d) => d.field).join(", ")}`
        : entry.status === "NEW_ONLY"
          ? "published on Diary 2.0 only — run pnpm legacy:export"
          : "published on the legacy site only — create it on Diary 2.0 with pnpm content:revise",
    rerun: "pnpm content:parity --report",
  }));

const counts = summarize(entries);
report(
  findings,
  {
    articles: entries.length,
    matched: counts.MATCHED,
    mismatched: entries.length - counts.MATCHED,
  },
  "parity",
);
