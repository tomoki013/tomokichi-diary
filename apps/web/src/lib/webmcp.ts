import {
  getArticleKnowledgeFromCatalog,
  searchKnowledgeCatalog,
  type KnowledgeCatalogEntry,
} from "@tomokichi/application";

interface WebMcpResult {
  content: { type: "text"; text: string }[];
  structuredContent: unknown;
}
interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean; consequentialHint: boolean };
  execute(input: Record<string, unknown>): Promise<WebMcpResult>;
}
interface ModelContext {
  registerTool(tool: WebMcpTool, options: { signal: AbortSignal }): void;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

const result = (value: unknown): WebMcpResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});
const annotations = { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false };

export function createWebMcpTools(
  catalog: readonly KnowledgeCatalogEntry[],
  articleId: string,
): readonly WebMcpTool[] {
  return [
    {
      name: "get_current_page_context",
      description: "現在表示中の旅行記事の要点と、検証済みの構造化事実を取得します。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations,
      execute: async () => result(getArticleKnowledgeFromCatalog(catalog, articleId)),
    },
    {
      name: "search_travel_content",
      description: "ともきちの旅行日記をキーワードで検索します。",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "旅先、交通、飲食などの検索語" } },
        required: ["query"],
        additionalProperties: false,
      },
      annotations,
      execute: async (input) =>
        result(searchKnowledgeCatalog(catalog, { query: String(input.query ?? "") })),
    },
    {
      name: "get_firsthand_experiences",
      description: "筆者が実際に体験し、本人確認済みの旅行情報だけを取得します。",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "任意の絞り込み語" } },
        additionalProperties: false,
      },
      annotations,
      execute: async (input) =>
        result(
          searchKnowledgeCatalog(catalog, {
            query: typeof input.query === "string" ? input.query : undefined,
            provenance: "firsthand",
          }),
        ),
    },
    {
      name: "show_article_section",
      description: "現在の記事内にある見出しを探し、その場所へ移動します。",
      inputSchema: {
        type: "object",
        properties: { heading: { type: "string", description: "表示したい見出し" } },
        required: ["heading"],
        additionalProperties: false,
      },
      annotations,
      execute: async (input) => {
        const heading = String(input.heading ?? "").toLocaleLowerCase("ja");
        const node = [...document.querySelectorAll<HTMLElement>("h2, h3")].find((item) =>
          (item.textContent ?? "").toLocaleLowerCase("ja").includes(heading),
        );
        node?.scrollIntoView({ behavior: "smooth", block: "start" });
        return result({ found: Boolean(node), heading: node?.textContent ?? null });
      },
    },
  ];
}

export function registerWebMcpTools(
  catalog: readonly KnowledgeCatalogEntry[],
  articleId: string,
): () => void {
  if (!document.modelContext) return () => {};
  const controller = new AbortController();
  for (const tool of createWebMcpTools(catalog, articleId)) {
    document.modelContext.registerTool(tool, { signal: controller.signal });
  }
  return () => controller.abort();
}
