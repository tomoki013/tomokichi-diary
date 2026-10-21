import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mcpFingerprint } from "../publication-mcp.js";
describe("actual MCP deployment fingerprint", () => {
  it("includes embedded catalog, UI, dependency code and lockfile while excluding build output", () => {
    const root = mkdtempSync(join(tmpdir(), "publication-mcp-"));
    try {
      for (const dir of [
        "apps/mcp-server/src",
        "apps/mcp-server/ui-dist",
        "packages/domain/src",
        "packages/domain/dist",
        "infrastructure",
        "export/knowledge",
      ])
        mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, "export/knowledge/catalog.json"), "[]");
      writeFileSync(join(root, "apps/mcp-server/src/index.ts"), "export {};");
      const original = mcpFingerprint(root);
      writeFileSync(join(root, "apps/mcp-server/ui-dist/index.html"), "generated");
      writeFileSync(join(root, "packages/domain/dist/index.js"), "generated");
      writeFileSync(join(root, "apps/mcp-server/tsconfig.tsbuildinfo"), "generated");
      expect(mcpFingerprint(root)).toBe(original);
      for (const path of [
        "export/knowledge/catalog.json",
        "apps/mcp-server/src/index.ts",
        "packages/domain/src/index.ts",
        "pnpm-lock.yaml",
      ]) {
        const before = mcpFingerprint(root);
        writeFileSync(join(root, path), `changed ${path}`);
        expect(mcpFingerprint(root)).not.toBe(before);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
