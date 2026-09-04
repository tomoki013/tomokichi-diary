import { createMcpHandler } from "agents/mcp/server";
import { describe, expect, it } from "vitest";
import { createServer } from "../server";

const endpoint = "https://tomokichi-diary-mcp.example/mcp";
const appHtml = '<!doctype html><html lang="ja"><body>evidence app</body></html>';
const context = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const handler = createMcpHandler(() => createServer("https://tomokichidiary.com", appHtml));
  const response = await handler(
    new Request(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    {},
    context,
  );
  const payload = await response.text();
  const data = payload.startsWith("event:")
    ? payload
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : payload;
  if (!data) throw new Error(`MCP response had no JSON-RPC data: ${payload}`);
  return { response, body: JSON.parse(data) as Record<string, any> };
}

describe("public MCP protocol", () => {
  it("negotiates the current protocol and advertises tools and resources", async () => {
    const { response, body } = await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(response.status).toBe(200);
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.capabilities).toMatchObject({ tools: {}, resources: {} });
  });

  it("publishes all read-only tools and links the evidence tool to its MCP App", async () => {
    const { body } = await rpc("tools/list");
    const tools = body.result.tools as Array<Record<string, any>>;
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_travel_content",
      "lookup_destination",
      "get_firsthand_experiences",
      "show_travel_evidence",
    ]);
    expect(tools.every((tool) => tool.annotations.readOnlyHint === true)).toBe(true);
    expect(tools.find((tool) => tool.name === "show_travel_evidence")?.["_meta"]).toEqual({
      ui: { resourceUri: "ui://tomokichi-diary/travel-evidence.html" },
    });
  });

  it("returns only firsthand facts, dates, absolute sources and the article URL", async () => {
    const { body } = await rpc("tools/call", {
      name: "get_firsthand_experiences",
      arguments: { query: "アブシンベル" },
    });
    const result = body.result as Record<string, any>;
    const items = result.structuredContent.items as Array<Record<string, any>>;
    expect(items).toHaveLength(1);
    const item = items[0];
    if (!item) throw new Error("expected one firsthand article");
    expect(item.facts.every((fact: Record<string, any>) => fact.provenance === "firsthand")).toBe(
      true,
    );
    expect(item.url).toBe("https://tomokichidiary.com/posts/howtoget-abusimbel-from-asuwan");
    expect(
      item.sources.every((source: Record<string, any>) => source.url.startsWith("https://")),
    ).toBe(true);
    expect(result.content[0].text).toContain("体験 2025-06-20");
  });

  it("serves a self-contained MCP App resource with the standard MIME type", async () => {
    const listed = await rpc("resources/list");
    expect(listed.body.result.resources).toContainEqual(
      expect.objectContaining({
        uri: "ui://tomokichi-diary/travel-evidence.html",
        mimeType: "text/html;profile=mcp-app",
      }),
    );
    const read = await rpc("resources/read", {
      uri: "ui://tomokichi-diary/travel-evidence.html",
    });
    expect(read.body.result.contents[0]).toMatchObject({
      uri: "ui://tomokichi-diary/travel-evidence.html",
      mimeType: "text/html;profile=mcp-app",
      text: appHtml,
    });
  });

  it("rejects invalid tool input through the MCP schema", async () => {
    const { body } = await rpc("tools/call", {
      name: "search_travel_content",
      arguments: { query: "" },
    });
    expect(body.result.isError).toBe(true);
  });
});
