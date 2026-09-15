import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebMcpTools, registerWebMcpTools } from "../webmcp";

const catalog = [
  {
    articleId: "a1",
    title: "アスワンからアブシンベル",
    summary: "バス移動",
    path: "/posts/a1",
    quickAnswer: "早朝バス",
    routes: [],
    sources: [],
    facts: [
      {
        id: "f1",
        kind: "transport" as const,
        statement: "実際にバスで移動した",
        provenance: "firsthand" as const,
        experiencedAt: "2025-01-01",
        verifiedAt: "2025-01-02",
        sourceIds: [],
      },
      {
        id: "f2",
        kind: "warning" as const,
        statement: "時刻は現地で確認する",
        provenance: "derived" as const,
        experiencedAt: null,
        verifiedAt: "2025-01-02",
        sourceIds: [],
      },
    ],
  },
];

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("WebMCP adapter", () => {
  it("serves search, the current page and firsthand-only evidence from the catalog", async () => {
    const tools = createWebMcpTools(catalog, "a1");
    const search = tools.find((item) => item.name === "search_travel_content")!;
    expect((await search.execute({ query: "バス" })).structuredContent).toHaveLength(1);
    expect(search.annotations.readOnlyHint).toBe(true);

    const current = await tools
      .find((tool) => tool.name === "get_current_page_context")!
      .execute({});
    expect(current.structuredContent).toMatchObject({ articleId: "a1" });

    const firsthand = await tools
      .find((tool) => tool.name === "get_firsthand_experiences")!
      .execute({ query: "バス" });
    const entries = firsthand.structuredContent as Array<{
      facts: Array<{ provenance: string }>;
    }>;
    expect(entries.flatMap((entry) => entry.facts)).toHaveLength(1);
    expect(
      entries.flatMap((entry) => entry.facts).every((fact) => fact.provenance === "firsthand"),
    ).toBe(true);
  });

  it("finds and scrolls to an article heading", async () => {
    const scrollIntoView = vi.fn();
    const headings = [
      { textContent: "アクセス方法", scrollIntoView },
      { textContent: "料金", scrollIntoView: vi.fn() },
    ];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { querySelectorAll: () => headings },
    });
    const tool = createWebMcpTools(catalog, "a1").find(
      (candidate) => candidate.name === "show_article_section",
    )!;
    expect((await tool.execute({ heading: "アクセス" })).structuredContent).toEqual({
      found: true,
      heading: "アクセス方法",
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("registers every tool with one lifecycle signal and aborts it on cleanup", () => {
    const registered: Array<{ name: string; signal: AbortSignal }> = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        modelContext: {
          registerTool: (tool: { name: string }, options: { signal: AbortSignal }) =>
            registered.push({ name: tool.name, signal: options.signal }),
        },
        querySelectorAll: () => [],
      },
    });
    const cleanup = registerWebMcpTools(catalog, "a1");
    expect(registered.map((item) => item.name)).toEqual([
      "get_current_page_context",
      "search_travel_content",
      "get_firsthand_experiences",
      "show_article_section",
    ]);
    expect(registered.every((item) => !item.signal.aborted)).toBe(true);
    cleanup();
    expect(registered.every((item) => item.signal.aborted)).toBe(true);
  });

  it("is a no-op when the browser does not expose WebMCP", () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { querySelectorAll: () => [] },
    });
    expect(() => registerWebMcpTools(catalog, "a1")()).not.toThrow();
  });
});
