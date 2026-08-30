import { performance } from "node:perf_hooks";
import type { ErrorCode } from "@tomokichi/contracts";
import { run, tail } from "./lib/run.js";
import {
  capFindings,
  renderSummary,
  writeArtifact,
  writeSummary,
  type CheckResult,
  type Finding,
  type Summary,
} from "./lib/report.js";

interface Step {
  name: string;
  code: ErrorCode;
  command: string;
  args: string[];
  rerun: string;
  /** Extracts headline numbers and structured findings from the captured output. */
  interpret?: (
    output: string,
    ok: boolean,
  ) => { metrics?: Record<string, string | number>; findings?: Finding[] };
  /** Skipped (not failed) while the underlying feature is not implemented yet. */
  optional?: boolean;
}

const STEPS: Step[] = [
  {
    name: "format",
    code: "FORMAT_CHECK_FAILED",
    command: "pnpm",
    args: ["exec", "prettier", "--check", "."],
    rerun: "pnpm format",
    interpret: (output) => {
      const files = output
        .split("\n")
        .filter((l) => l.startsWith("[warn] ") && !l.includes("Code style issues"));
      return {
        findings: files.map((l) => ({
          code: "FORMAT_CHECK_FAILED" as const,
          target: l.replace("[warn] ", "").trim(),
          rerun: "pnpm format",
        })),
      };
    },
  },
  {
    name: "lint",
    code: "LINT_FAILED",
    command: "pnpm",
    args: ["run", "lint"],
    rerun: "pnpm lint",
    interpret: (output, ok) => {
      const match = /Found (\d+) warnings? and (\d+) errors?/.exec(output);
      const errors = match ? Number(match[2]) : ok ? 0 : 1;
      return { metrics: { lint: errors } };
    },
  },
  {
    name: "typecheck",
    code: "TYPECHECK_FAILED",
    command: "pnpm",
    args: ["run", "typecheck"],
    rerun: "pnpm typecheck",
    interpret: (output) => {
      const findings = output
        .split("\n")
        .filter((l) => /error TS\d+/.test(l))
        .map((l) => ({
          code: "TYPECHECK_FAILED" as const,
          target: l.split("(")[0]?.trim(),
          message: l.trim(),
          rerun: "pnpm typecheck",
        }));
      return { findings };
    },
  },
  {
    name: "boundaries",
    code: "BOUNDARY_VIOLATION",
    command: "pnpm",
    args: ["exec", "tsx", "scripts/check-boundaries.ts", "--json"],
    rerun: "pnpm exec tsx scripts/check-boundaries.ts",
    interpret: (output) => parseJsonFindings(output),
  },
  {
    name: "test",
    code: "TEST_FAILED",
    command: "pnpm",
    args: ["exec", "vitest", "run", "--reporter=dot"],
    rerun: "pnpm test",
    interpret: (output) => {
      const match = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(output);
      const failed = match?.[1] ? Number(match[1]) : 0;
      const passed = match?.[2] ? Number(match[2]) : 0;
      const findings: Finding[] = output
        .split("\n")
        .filter((l) => /^\s*(FAIL|×)\s/.test(l))
        .map((l) => ({
          code: "TEST_FAILED" as const,
          target: l.replace(/^\s*(FAIL|×)\s*/, "").trim(),
          rerun: "pnpm test",
        }));
      return { metrics: { tests: failed ? `${passed}/${passed + failed}` : passed }, findings };
    },
  },
  {
    name: "media",
    code: "BUILD_FAILED",
    command: "pnpm",
    args: ["run", "media:build"],
    rerun: "pnpm media:build",
    interpret: (output) => {
      const match = /(\d+) derivatives \((\d+) cached\)/.exec(output);
      return match ? { metrics: { media: `${match[1]}` } } : {};
    },
  },
  {
    name: "build",
    code: "BUILD_FAILED",
    command: "pnpm",
    args: ["run", "build"],
    rerun: "pnpm build",
  },
  {
    name: "routes",
    code: "ROUTE_LEGACY_MISSING",
    command: "pnpm",
    args: ["exec", "tsx", "scripts/check-routes.ts", "--json"],
    rerun: "pnpm check:routes",
    optional: true,
    interpret: (output) => parseJsonFindings(output),
  },
  {
    name: "seo",
    code: "SEO_CANONICAL_MISSING",
    command: "pnpm",
    args: ["exec", "tsx", "scripts/check-seo.ts", "--json"],
    rerun: "pnpm check:seo",
    optional: true,
    interpret: (output) => parseJsonFindings(output),
  },
  {
    name: "links",
    code: "LINK_INTERNAL_BROKEN",
    command: "pnpm",
    args: ["exec", "tsx", "scripts/check-links.ts", "--json"],
    rerun: "pnpm check:links",
    optional: true,
    interpret: (output) => parseJsonFindings(output),
  },
  {
    name: "perf",
    code: "PERF_SCORE",
    command: "pnpm",
    args: ["exec", "tsx", "scripts/perf.ts", "--json"],
    rerun: "pnpm perf",
    optional: true,
    interpret: (output) => parseJsonFindings(output),
  },
];

/** Checks report `{ metrics, findings, skipped }` as a single JSON line on stdout. */
function parseJsonFindings(output: string): {
  metrics?: Record<string, string | number>;
  findings?: Finding[];
  skipped?: boolean;
} {
  const line = output
    .split("\n")
    .toReversed()
    .find((l) => l.trim().startsWith("{"));
  if (!line) return {};
  try {
    return JSON.parse(line) as ReturnType<typeof parseJsonFindings>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const checks: CheckResult[] = [];

  for (const step of STEPS) {
    if (only.length > 0 && !only.includes(step.name)) continue;
    const stepStart = performance.now();
    const outcome = await run(step.command, step.args);
    const interpreted = step.interpret?.(outcome.output, outcome.ok) ?? {};
    const skipped = (interpreted as { skipped?: boolean }).skipped === true;

    let findings = interpreted.findings ?? [];
    if (!outcome.ok && findings.length === 0 && !skipped) {
      findings = [{ code: step.code, message: tail(outcome.output, 8), rerun: step.rerun }];
    }

    const status: CheckResult["status"] = skipped
      ? "skipped"
      : findings.length > 0 || !outcome.ok
        ? "failed"
        : "passed";

    checks.push({
      name: step.name,
      status,
      durationMs: Math.round(performance.now() - stepStart),
      metrics: interpreted.metrics,
      findings,
      log: outcome.output,
    });

    // Fail fast on the cheap gates; keep running the reporting checks so one
    // pass surfaces every route/SEO/perf problem at once.
    if (
      status === "failed" &&
      ["format", "lint", "typecheck", "boundaries", "test", "build"].includes(step.name)
    ) {
      break;
    }
  }

  for (const check of checks) {
    if (check.log) writeArtifact(`logs/${check.name}.log`, check.log);
    delete check.log;
  }

  const failedChecks = checks.flatMap((c) => c.findings);
  const summary: Summary = {
    status: failedChecks.length > 0 ? "failed" : "passed",
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    checks,
    failedChecks,
  };
  writeSummary(summary);

  process.stdout.write(
    `${renderSummary({ ...summary, failedChecks: capFindings(failedChecks) })}\n`,
  );
  process.exit(summary.status === "failed" ? 1 : 0);
}

await main();
