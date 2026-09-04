import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { queryCatalog } from "./catalog.js";
import EVIDENCE_APP_HTML from "../ui-dist/index.html";

const RESOURCE_URI = "ui://tomokichi-diary/travel-evidence.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const provenance = z.enum(["firsthand", "official", "researched", "derived"]);
const factKind = z.enum([
  "visit",
  "food_drink",
  "transport",
  "cost",
  "duration",
  "procedure",
  "observation",
  "recommendation",
  "warning",
  "current_fact",
]);

const textResult = (items: ReturnType<typeof queryCatalog>, siteOrigin: string) => {
  const enriched = items.map((entry) => ({
    ...entry,
    url: new URL(entry.path, siteOrigin).toString(),
  }));
  return {
    content: [
      {
        type: "text" as const,
        text:
          enriched.length > 0
            ? enriched
                .map(
                  (entry) => `${entry.title}\n${entry.quickAnswer ?? entry.summary}\n${entry.url}`,
                )
                .join("\n\n")
            : "条件に合う検証済みの旅行情報はありません。",
      },
    ],
    structuredContent: { items: enriched },
  };
};

export function createServer(siteOrigin: string) {
  const server = new McpServer({ name: "Tomokichi Diary Travel Knowledge", version: "1.0.0" });
  server.registerTool(
    "search_travel_content",
    {
      title: "Search travel content",
      description: "旅先、交通、食事などから、ともきちの旅行記事と検証済み事実を検索します。",
      inputSchema: { query: z.string().min(1).max(200), provenance: provenance.optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, provenance: source }) =>
      textResult(queryCatalog({ query, provenance: source }), siteOrigin),
  );

  server.registerTool(
    "lookup_destination",
    {
      title: "Look up destination",
      description: "地名を指定して関連する旅行記事・現地情報を取得します。",
      inputSchema: { query: z.string().min(1).max(200) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) => textResult(queryCatalog({ query }), siteOrigin),
  );

  server.registerTool(
    "get_firsthand_experiences",
    {
      title: "Get firsthand experiences",
      description: "筆者本人が体験し、人が確認した旅行事実だけを取得します。",
      inputSchema: { query: z.string().max(200).optional(), kind: factKind.optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, kind }) =>
      textResult(queryCatalog({ query, kind, provenance: "firsthand" }), siteOrigin),
  );

  server.registerTool(
    "show_travel_evidence",
    {
      title: "Show travel evidence",
      description: "旅行情報と、その根拠・体験日・確認日をカードで表示します。",
      inputSchema: { query: z.string().max(200).optional(), kind: factKind.optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ query, kind }) => textResult(queryCatalog({ query, kind }), siteOrigin),
  );

  server.registerResource(
    "travel-evidence-app",
    RESOURCE_URI,
    {
      title: "Tomokichi Diary travel evidence",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: EVIDENCE_APP_HTML }],
    }),
  );
  return server;
}
