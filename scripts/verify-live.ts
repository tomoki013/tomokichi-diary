import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLegacyBaseline } from "./lib/built-site.js";

/**
 * Cutover check: every URL the previous site published must answer on the
 * deployed site, and every redirect must land on a real page (instruction §9).
 *
 *   pnpm verify:live https://tomokichi-diary.pages.dev
 */
const BASE = (
  process.argv[2] ??
  process.env.VERIFY_BASE_URL ??
  "https://tomokichi-diary.pages.dev"
).replace(/\/+$/, "");
const CONCURRENCY = 8;

interface Probe {
  path: string;
  status: number;
  location: string | null;
}

async function sweep(paths: readonly string[]): Promise<Probe[]> {
  const queue = [...paths];
  const results: Probe[] = [];
  const worker = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      try {
        const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
        results.push({ path, status: response.status, location: response.headers.get("location") });
      } catch {
        results.push({ path, status: 0, location: null });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

mkdirSync(join(process.cwd(), ".artifacts", "ci"), { recursive: true });

const legacy = loadLegacyBaseline<{ path: string }>("legacy-routes.json").map(
  (entry) => entry.path,
);
const probes = await sweep(legacy);

const served = probes.filter((probe) => probe.status === 200);
const redirects = probes.filter((probe) => probe.status >= 300 && probe.status < 400);
const broken = probes.filter((probe) => probe.status >= 400 || probe.status === 0);

// A redirect that points at a 404 is no better than a 404.
const targets = await sweep(
  redirects.map((probe) => {
    const location = probe.location ?? "/";
    return location.startsWith("http") ? new URL(location).pathname : location;
  }),
);
const badTargets = targets.filter((probe) => probe.status !== 200);

const lines = [
  `base:      ${BASE}`,
  `legacy:    ${probes.length}`,
  `200:       ${served.length}`,
  `redirects: ${redirects.length} (${redirects.length - badTargets.length} land on a page)`,
  `broken:    ${broken.length}`,
];
for (const probe of [...broken, ...badTargets].slice(0, 20)) {
  lines.push(`  ✗ ${probe.path} → ${probe.status}`);
}
lines.push(
  broken.length === 0 && badTargets.length === 0
    ? "✓ every legacy URL resolves"
    : "✗ ROUTE_LEGACY_MISSING",
);

process.stdout.write(`${lines.join("\n")}\n`);

writeFileSync(
  join(process.cwd(), ".artifacts", "ci", "verify-live.json"),
  `${JSON.stringify({ base: BASE, probes, badTargets }, null, 2)}\n`,
);

process.exit(broken.length === 0 && badTargets.length === 0 ? 0 : 1);
