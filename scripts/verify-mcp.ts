const origin = (process.argv[2] ?? "").replace(/\/$/, "");
if (!origin.startsWith("https://") && !origin.startsWith("http://localhost")) {
  throw new Error("usage: pnpm verify:mcp https://<worker-host>");
}

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const payload = await response.text();
  const data = payload.startsWith("event:")
    ? payload
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : payload;
  if (!data) throw new Error(`${method} returned no JSON-RPC data`);
  const body = JSON.parse(data) as Record<string, any>;
  if (body.error) throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  return body.result as Record<string, any>;
}

const health = await fetch(`${origin}/health`);
if (!health.ok || ((await health.json()) as { status?: string }).status !== "ok")
  throw new Error(`health check failed with HTTP ${health.status}`);

const initialized = await rpc("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "tomokichi-production-verifier", version: "1.0.0" },
});
if (initialized.protocolVersion !== "2025-11-25") throw new Error("protocol negotiation failed");

const listed = await rpc("tools/list");
const names = (listed.tools as Array<{ name: string }>).map((tool) => tool.name);
for (const expected of [
  "search_travel_content",
  "lookup_destination",
  "get_firsthand_experiences",
  "show_travel_evidence",
]) {
  if (!names.includes(expected)) throw new Error(`missing MCP tool ${expected}`);
}

const called = await rpc("tools/call", {
  name: "get_firsthand_experiences",
  arguments: { query: "アブシンベル" },
});
const items = called.structuredContent?.items as Array<{
  facts: Array<{ provenance: string }>;
}>;
if (
  !items?.length ||
  items.flatMap((item) => item.facts).some((fact) => fact.provenance !== "firsthand")
)
  throw new Error("firsthand tool returned missing or mixed-provenance evidence");

const resources = await rpc("resources/list");
const resource = (resources.resources as Array<{ uri: string; mimeType?: string }>).find(
  (item) => item.uri === "ui://tomokichi-diary/travel-evidence.html",
);
if (resource?.mimeType !== "text/html;profile=mcp-app")
  throw new Error("MCP App resource is missing");
const read = await rpc("resources/read", { uri: resource.uri });
if (!(read.contents as Array<{ text?: string }>)[0]?.text?.includes("<!doctype html>"))
  throw new Error("MCP App resource has no bundled HTML");

process.stdout.write(
  `✓ MCP ${origin} | protocol ${initialized.protocolVersion} | tools ${names.length} | firsthand ${items.length} | app ok\n`,
);
