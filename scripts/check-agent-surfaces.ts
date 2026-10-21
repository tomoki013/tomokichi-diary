import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listBuiltPages, loadSnapshot, readBuiltPage, report } from "./lib/built-site.js";

const root = process.cwd();
const snapshot = loadSnapshot();
const pages = new Map(listBuiltPages().map((page) => [page.path, page]));
const findings: { code: string; target: string; message: string }[] = [];

/** Contents of the same-site module scripts a built page loads from `/_astro/`. */
function bundledScripts(html: string): string[] {
  return [...html.matchAll(/<script[^>]+src="\/(_astro\/[^"]+\.js)"/g)].flatMap(([, path]) => {
    const file = join(root, "apps", "web", "dist", path ?? "");
    return existsSync(file) ? [readFileSync(file, "utf8")] : [];
  });
}
const tools = [
  "get_current_page_context",
  "search_travel_content",
  "get_firsthand_experiences",
  "show_article_section",
];

for (const knowledge of snapshot.articleKnowledge) {
  const article = snapshot.articles.find((item) => item.id === knowledge.articleId);
  const route = snapshot.routes.find(
    (item) =>
      item.targetType === "article" && item.targetId === knowledge.articleId && item.isCanonical,
  );
  if (!article || !route) continue;
  const page = pages.get(route.path);
  if (!page) {
    findings.push({
      code: "AGENT_SURFACE_FAILED",
      target: route.path,
      message: "knowledge article has no built HTML page",
    });
    continue;
  }
  const html = readBuiltPage(page);
  if (!html.includes('id="webmcp-context"') || !html.includes(`"articleId":"${article.id}"`)) {
    findings.push({
      code: "AGENT_SURFACE_FAILED",
      target: route.path,
      message: "page does not embed its WebMCP context",
    });
  }
  // The tools may be registered by an inline script or by a module the page
  // loads (Vite moves the script out once it shares code with another page),
  // so search the page together with its own bundled scripts.
  const surface = [html, ...bundledScripts(html)].join("\n");
  for (const tool of tools) {
    if (!surface.includes(tool))
      findings.push({
        code: "AGENT_SURFACE_FAILED",
        target: route.path,
        message: `page does not register WebMCP tool ${tool}`,
      });
  }
  const knowledgeFile = join(root, "apps", "web", "dist", "knowledge", `${article.slug}.json`);
  if (!existsSync(knowledgeFile)) {
    findings.push({
      code: "AGENT_SURFACE_FAILED",
      target: route.path,
      message: "machine-readable knowledge endpoint was not built",
    });
  } else {
    const payload = JSON.parse(readFileSync(knowledgeFile, "utf8")) as { articleId?: string };
    if (payload.articleId !== article.id)
      findings.push({
        code: "AGENT_SURFACE_FAILED",
        target: knowledgeFile,
        message: "knowledge endpoint article identity does not match",
      });
  }
}

const appBundle = join(root, "apps", "mcp-server", "ui-dist", "index.html");
if (!process.argv.includes("--web-only") && !existsSync(appBundle))
  findings.push({
    code: "AGENT_SURFACE_FAILED",
    target: appBundle,
    message: "MCP App single-file bundle was not built",
  });

report(
  findings,
  {
    webMcpPages: snapshot.articleKnowledge.length,
    webMcpTools: tools.length,
    mcpAppBytes: existsSync(appBundle) ? statSync(appBundle).size : 0,
  },
  "agent surfaces",
);
