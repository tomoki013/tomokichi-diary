import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { relative } from "node:path";
import type { Finding } from "./lib/report.js";

/**
 * Dependency direction is enforced here rather than with a dedicated
 * architecture tool (see docs/adr/0003-framework-independent-domain.md).
 * Keep this list short: it exists to protect the Core, not to police style.
 */
interface Rule {
  /** Glob of source files the rule applies to. */
  files: string;
  /** Workspace packages these files may import. */
  allowedWorkspace: string[];
  /** Import specifiers these files may never reach for. */
  forbidden: RegExp[];
}

const FRAMEWORKS = [
  /^astro(\/|$)/,
  /^@astrojs\//,
  /^react(-dom)?(\/|$)/,
  /^hono(\/|$)/,
  /^@cloudflare\//,
  /^wrangler(\/|$)/,
  /^vite(\/|$)/,
];

const RULES: Rule[] = [
  {
    files: "packages/domain/src/**/*.ts",
    allowedWorkspace: ["@tomokichi/contracts"],
    forbidden: FRAMEWORKS,
  },
  { files: "packages/contracts/src/**/*.ts", allowedWorkspace: [], forbidden: FRAMEWORKS },
  {
    files: "packages/application/src/**/*.ts",
    allowedWorkspace: ["@tomokichi/domain", "@tomokichi/data", "@tomokichi/contracts"],
    forbidden: FRAMEWORKS,
  },
  {
    files: "packages/data/src/**/*.ts",
    allowedWorkspace: ["@tomokichi/domain", "@tomokichi/contracts"],
    forbidden: FRAMEWORKS,
  },
  {
    files: "packages/seo/src/**/*.ts",
    allowedWorkspace: ["@tomokichi/domain", "@tomokichi/contracts"],
    forbidden: FRAMEWORKS,
  },
  {
    files: "infrastructure/**/src/**/*.ts",
    allowedWorkspace: [
      "@tomokichi/domain",
      "@tomokichi/application",
      "@tomokichi/data",
      "@tomokichi/contracts",
    ],
    forbidden: [/^astro(\/|$)/, /^@astrojs\//, /^react(-dom)?(\/|$)/, /^hono(\/|$)/],
  },
];

// Test files are not shipped, so they may reach for in-memory adapters.
const isExcluded = (path: string): boolean =>
  path.includes("node_modules") || path.includes("__tests__") || path.endsWith(".test.ts");

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)[\s\S]{0,200}?from\s+["']([^"']+)["']|require\(["']([^"']+)["']\)/g;

function specifiersOf(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (spec) out.push(spec);
  }
  return out;
}

function check(): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    for (const file of globSync(rule.files, { exclude: isExcluded })) {
      const source = readFileSync(file, "utf8");
      for (const spec of specifiersOf(source)) {
        if (spec.startsWith(".") || spec.startsWith("node:")) continue;

        if (
          spec.startsWith("@tomokichi/") &&
          !rule.allowedWorkspace.includes(spec.split("/").slice(0, 2).join("/"))
        ) {
          findings.push({
            code: "BOUNDARY_VIOLATION",
            target: `${relative(process.cwd(), file)} → ${spec}`,
            message: `not allowed here; permitted: ${rule.allowedWorkspace.join(", ") || "(none)"}`,
            rerun: "pnpm exec tsx scripts/check-boundaries.ts",
          });
          continue;
        }
        if (rule.forbidden.some((re) => re.test(spec))) {
          findings.push({
            code: "BOUNDARY_VIOLATION",
            target: `${relative(process.cwd(), file)} → ${spec}`,
            message: "framework import is not allowed in this layer",
            rerun: "pnpm exec tsx scripts/check-boundaries.ts",
          });
        }
      }
    }
  }
  return findings;
}

const findings = check();
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ findings })}\n`);
} else if (findings.length === 0) {
  process.stdout.write("✓ boundaries\n");
} else {
  for (const f of findings) process.stdout.write(`${f.code} ${f.target}\n  ${f.message}\n`);
}
process.exit(findings.length > 0 ? 1 : 0);
