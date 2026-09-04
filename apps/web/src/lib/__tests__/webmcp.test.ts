import { describe, expect, it } from "vitest";
import { createWebMcpTools } from "../webmcp";

const catalog = [
  {
    articleId: "a1",
    title: "アスワンからアブシンベル",
    summary: "バス移動",
    path: "/posts/a1",
    quickAnswer: "早朝バス",
    routes: [],
    facts: [
      {
        id: "f1",
        kind: "transport" as const,
        statement: "実際にバスで移動した",
        provenance: "firsthand" as const,
        experiencedAt: "2025-01-01",
        verifiedAt: "2025-01-02",
      },
    ],
  },
];

describe("WebMCP adapter", () => {
  it("exposes protocol tools backed by the shared catalog query", async () => {
    const tools = createWebMcpTools(catalog, "a1");
    expect(tools.map((tool) => tool.name)).toContain("get_firsthand_experiences");
    const tool = tools.find((item) => item.name === "search_travel_content")!;
    const response = await tool.execute({ query: "バス" });
    expect(response.structuredContent).toHaveLength(1);
    expect(tool.annotations.readOnlyHint).toBe(true);
  });
});
