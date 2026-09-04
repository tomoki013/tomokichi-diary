import { readFileSync } from "node:fs";
import { join } from "node:path";

const path = join(process.cwd(), "ui-dist", "index.html");
const html = readFileSync(path, "utf8");
const failures = [
  !/^<!doctype html>/i.test(html) && "missing HTML doctype",
  /<script[^>]+src=/i.test(html) && "contains an external script",
  /<link[^>]+rel=["']stylesheet/i.test(html) && "contains an external stylesheet",
  !html.includes("旅の根拠ビュー") && "missing evidence view content",
  Buffer.byteLength(html) > 1_000_000 && "single-file UI exceeds 1 MB",
].filter(Boolean);

if (failures.length > 0) throw new Error(`invalid MCP App bundle: ${failures.join("; ")}`);
process.stdout.write(`✓ MCP App single-file bundle ${Buffer.byteLength(html)} bytes\n`);
