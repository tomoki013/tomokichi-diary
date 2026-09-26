import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Checks the boundaries that a workers.dev route sweep cannot see: the
 * canonical host, indexability, www/http redirects, the API CORS origin and
 * the service-worker handoff. Run this immediately after the DNS cutover.
 *
 *   pnpm verify:cutover https://tomokichidiary.com
 */
const BASE = (process.argv[2] ?? process.env.CUTOVER_URL ?? "https://tomokichidiary.com").replace(
  /\/+$/,
  "",
);
const SITE = new URL(BASE);
const EXPECTED_HOST = "tomokichidiary.com";
const API_BASE = (process.env.CUTOVER_API_URL ?? "https://api.tomokichidiary.com").replace(
  /\/+$/,
  "",
);

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? "✓" : "✗"} ${name}: ${detail}\n`);
}

async function fetchUrl(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, redirect: "manual" });
  } catch {
    return null;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response | null> {
  const response = await fetchUrl(`${BASE}${path}`, init);
  if (!response) record(path, false, "unreachable");
  return response;
}

if (SITE.protocol !== "https:") {
  record("site protocol", false, `${SITE.protocol} must be https:`);
}
if (SITE.hostname !== EXPECTED_HOST) {
  record("site host", false, `${SITE.hostname} must be ${EXPECTED_HOST}`);
}

const homeResponse = await request("/");
const home = homeResponse ? await homeResponse.text() : "";
record(
  "homepage",
  homeResponse?.status === 200 &&
    homeResponse.headers.get("content-type")?.includes("text/html") === true,
  homeResponse ? `HTTP ${homeResponse.status}` : "unreachable",
);

const canonical = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(home)?.[1];
record(
  "homepage canonical",
  canonical === BASE || canonical === `${BASE}/`,
  canonical ? `found ${canonical}` : "missing",
);

const robotsMeta =
  /<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']+)["']/i.exec(home)?.[1] ?? "";
record(
  "homepage indexability",
  Boolean(robotsMeta) && !robotsMeta.toLowerCase().includes("noindex"),
  robotsMeta ? `robots=${robotsMeta}` : "robots meta missing",
);

const robotsResponse = await request("/robots.txt");
const robots = robotsResponse ? await robotsResponse.text() : "";
const robotsLines = robots.split(/\r?\n/).map((line) => line.trim());
const robotsLineSet = new Set(robotsLines);
record(
  "robots.txt",
  robotsResponse?.status === 200 &&
    robotsLineSet.has("Allow: /") &&
    !robotsLineSet.has("Disallow: /") &&
    robotsLineSet.has(`Sitemap: ${BASE}/sitemap.xml`),
  robotsResponse ? `HTTP ${robotsResponse.status}` : "unreachable",
);

const sitemapResponse = await request("/sitemap.xml");
const sitemap = sitemapResponse ? await sitemapResponse.text() : "";
const sitemapLocations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
const childSitemapUrls = sitemap.includes("<sitemapindex") ? sitemapLocations : [];
const childSitemapBodies = await Promise.all(
  childSitemapUrls.map(async (url) => {
    const response = await fetchUrl(url);
    return response?.status === 200 ? response.text() : "";
  }),
);
const allSitemapLocations = [
  ...sitemapLocations,
  ...childSitemapBodies.flatMap((body) =>
    [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!),
  ),
];
record(
  "sitemap.xml",
  sitemapResponse?.status === 200 &&
    (allSitemapLocations.includes(BASE) || allSitemapLocations.includes(`${BASE}/`)) &&
    allSitemapLocations
      .filter((location) => location.startsWith("http"))
      .every((location) => location === BASE || location.startsWith(`${BASE}/`)),
  sitemapResponse ? `${allSitemapLocations.length} URL(s) across sitemap file(s)` : "unreachable",
);

const wwwResponse = await fetch(`https://www.${EXPECTED_HOST}/`, { redirect: "manual" }).catch(
  () => null,
);
record(
  "www redirect",
  (wwwResponse?.status === 301 || wwwResponse?.status === 308) &&
    wwwResponse.headers.get("location") === `${BASE}/`,
  wwwResponse
    ? `HTTP ${wwwResponse.status} → ${wwwResponse.headers.get("location") ?? "(none)"}`
    : "unreachable",
);

const httpResponse = await fetch(`http://${EXPECTED_HOST}/`, { redirect: "manual" }).catch(
  () => null,
);
record(
  "http redirect",
  (httpResponse?.status === 301 || httpResponse?.status === 308) &&
    httpResponse.headers.get("location") === `${BASE}/`,
  httpResponse
    ? `HTTP ${httpResponse.status} → ${httpResponse.headers.get("location") ?? "(none)"}`
    : "unreachable",
);

const serviceWorker = await request("/sw.js");
const serviceWorkerBody = serviceWorker ? await serviceWorker.text() : "";
record(
  "service worker",
  serviceWorker?.status === 200 && serviceWorkerBody.includes("addEventListener"),
  serviceWorker ? `HTTP ${serviceWorker.status}` : "unreachable",
);

const mediaUrl = home.match(/https:\/\/media\.tomokichidiary\.com\/[^"'\s<]+/)?.[0];
const mediaResponse = mediaUrl ? await fetchUrl(mediaUrl) : null;
record(
  "media asset",
  mediaResponse?.status === 200,
  mediaUrl
    ? `HTTP ${mediaResponse?.status ?? "unreachable"} for ${new URL(mediaUrl).pathname}`
    : "no media URL found on homepage",
);

const apiResponse = await fetch(`${API_BASE}/health`, {
  headers: { origin: `${BASE}` },
}).catch(() => null);
const apiAllowOrigin = apiResponse?.headers.get("access-control-allow-origin");
record(
  "API health and CORS",
  apiResponse?.status === 200 && apiAllowOrigin === BASE,
  apiResponse
    ? `HTTP ${apiResponse.status}, access-control-allow-origin=${apiAllowOrigin ?? "(none)"}`
    : "unreachable",
);

mkdirSync(join(process.cwd(), ".artifacts", "ci"), { recursive: true });
writeFileSync(
  join(process.cwd(), ".artifacts", "ci", "verify-cutover.json"),
  `${JSON.stringify({ base: BASE, checks }, null, 2)}\n`,
);

process.stdout.write(
  `cutover checks: ${checks.filter((check) => check.ok).length}/${checks.length}\n`,
);
process.exit(checks.every((check) => check.ok) ? 0 : 1);
