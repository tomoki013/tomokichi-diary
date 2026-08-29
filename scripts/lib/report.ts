import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ErrorCode } from "@tomokichi/contracts";

export const ARTIFACT_DIR = join(process.cwd(), ".artifacts", "ci");

export interface Finding {
  code: ErrorCode;
  /** Route, file or entity the finding is about. */
  target?: string;
  message?: string;
  actual?: string | number;
  limit?: string | number;
  baseline?: string | number;
  /** Command that reproduces this finding locally. */
  rerun?: string;
}

export interface CheckResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  /** Short values rendered in the one-line success summary, e.g. `{ tests: 186 }`. */
  metrics?: Record<string, string | number>;
  findings: Finding[];
  /** Full output, written to an artifact rather than stdout. */
  log?: string;
}

export interface Summary {
  status: "passed" | "failed";
  startedAt: string;
  durationMs: number;
  checks: CheckResult[];
  failedChecks: Finding[];
}

export function writeArtifact(relativePath: string, contents: string): string {
  const path = join(ARTIFACT_DIR, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

export function writeSummary(summary: Summary): string {
  return writeArtifact("summary.json", `${JSON.stringify(summary, null, 2)}\n`);
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Success: one line. Failure: only what failed, most actionable field first. */
export function renderSummary(summary: Summary): string {
  if (summary.status === "passed") {
    const metrics = summary.checks
      .filter((c) => c.status === "passed" && c.metrics)
      .flatMap((c) => Object.entries(c.metrics ?? {}))
      .map(([key, value]) => `${key} ${value}`);
    const skipped = summary.checks.filter((c) => c.status === "skipped").length;
    const parts = [`✓ CI ${fmtDuration(summary.durationMs)}`, ...metrics];
    if (skipped > 0) parts.push(`skipped ${skipped}`);
    return parts.join(" | ");
  }

  const lines: string[] = [];
  const n = summary.failedChecks.length;
  lines.push(`✗ ${n} check${n === 1 ? "" : "s"} failed`);
  for (const f of summary.failedChecks) {
    lines.push("");
    lines.push(f.code);
    if (f.target) lines.push(`  target:   ${f.target}`);
    if (f.actual !== undefined) lines.push(`  actual:   ${f.actual}`);
    if (f.limit !== undefined) lines.push(`  limit:    ${f.limit}`);
    if (f.baseline !== undefined) lines.push(`  baseline: ${f.baseline}`);
    if (f.message) lines.push(`  detail:   ${f.message}`);
    if (f.rerun) lines.push(`  rerun:    ${f.rerun}`);
  }
  lines.push("");
  lines.push(`details: .artifacts/ci/summary.json`);
  lines.push(`runbook: docs/OPERATIONS.md`);
  return lines.join("\n");
}

/** Caps how many findings of one code reach stdout; the rest stay in the artifact. */
export const MAX_RENDERED_PER_CODE = 5;

export function capFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, number>();
  const out: Finding[] = [];
  for (const f of findings) {
    const count = seen.get(f.code) ?? 0;
    seen.set(f.code, count + 1);
    if (count < MAX_RENDERED_PER_CODE) out.push(f);
  }
  for (const [code, count] of seen) {
    if (count > MAX_RENDERED_PER_CODE) {
      out.push({
        code: code as ErrorCode,
        message: `+${count - MAX_RENDERED_PER_CODE} more ${code} findings in .artifacts/ci/summary.json`,
      });
    }
  }
  return out;
}
