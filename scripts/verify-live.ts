import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLegacyBaseline, loadSnapshot } from "./lib/built-site.js";

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

interface AgentSurfaceProbe {
  path: string;
  pageStatus: number;
  knowledgeStatus: number;
  valid: boolean;
  message: string | null;
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

// Route availability alone can accidentally validate the retired site. Confirm
// that every migrated article exposes the live WebMCP page and JSON projection.
const snapshot = loadSnapshot();
const agentSurfaces: AgentSurfaceProbe[] = [];
for (const knowledge of snapshot.articleKnowledge) {
  const article = snapshot.articles.find((item) => item.id === knowledge.articleId);
  const route = snapshot.routes.find(
    (item) =>
      item.targetType === "article" && item.targetId === knowledge.articleId && item.isCanonical,
  );
  if (!article || !route) continue;
  const [pageResponse, knowledgeResponse] = await Promise.all([
    fetch(`${BASE}${route.path}`),
    fetch(`${BASE}/knowledge/${article.slug}.json`),
  ]);
  const [html, payload] = await Promise.all([pageResponse.text(), knowledgeResponse.text()]);
  const hasWebMcp =
    html.includes('id="webmcp-context"') &&
    html.includes("get_current_page_context") &&
    html.includes("get_firsthand_experiences");
  const hasQuickAnswerOnly = html.includes("Quick Answer") && !html.includes("先に結論");
  let hasKnowledge = false;
  try {
    hasKnowledge =
      knowledgeResponse.ok &&
      (JSON.parse(payload) as { articleId?: string }).articleId === article.id;
  } catch {
    hasKnowledge = false;
  }
  const problems = [
    !pageResponse.ok && `page returned ${pageResponse.status}`,
    !hasWebMcp && "WebMCP context/tools missing",
    !hasQuickAnswerOnly && "Quick Answer contract missing",
    !hasKnowledge && `knowledge JSON invalid (${knowledgeResponse.status})`,
  ].filter(Boolean);
  agentSurfaces.push({
    path: route.path,
    pageStatus: pageResponse.status,
    knowledgeStatus: knowledgeResponse.status,
    valid: problems.length === 0,
    message: problems.length > 0 ? problems.join("; ") : null,
  });
}
const brokenAgentSurfaces = agentSurfaces.filter((probe) => !probe.valid);

const lines = [
  `base:      ${BASE}`,
  `legacy:    ${probes.length}`,
  `200:       ${served.length}`,
  `redirects: ${redirects.length} (${redirects.length - badTargets.length} land on a page)`,
  `broken:    ${broken.length}`,
  `agents:    ${agentSurfaces.length - brokenAgentSurfaces.length}/${agentSurfaces.length}`,
];
for (const probe of [...broken, ...badTargets].slice(0, 20)) {
  lines.push(`  ✗ ${probe.path} → ${probe.status}`);
}
for (const probe of brokenAgentSurfaces.slice(0, 20)) {
  lines.push(`  ✗ ${probe.path} → ${probe.message}`);
}
const valid = broken.length === 0 && badTargets.length === 0 && brokenAgentSurfaces.length === 0;
lines.push(valid ? "✓ routes and agent surfaces are live" : "✗ LIVE_VERIFICATION_FAILED");

process.stdout.write(`${lines.join("\n")}\n`);

writeFileSync(
  join(process.cwd(), ".artifacts", "ci", "verify-live.json"),
  `${JSON.stringify({ base: BASE, probes, badTargets, agentSurfaces }, null, 2)}\n`,
);

process.exit(valid ? 0 : 1);
