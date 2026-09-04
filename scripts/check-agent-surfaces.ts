import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listBuiltPages, loadSnapshot, readBuiltPage, report } from "./lib/built-site.js";

const root = process.cwd();
const snapshot = loadSnapshot();
const pages = new Map(listBuiltPages().map((page) => [page.path, page]));
const findings: { code: string; target: string; message: string }[] = [];
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
  for (const tool of tools) {
    if (!html.includes(tool))
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
if (!existsSync(appBundle))
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
