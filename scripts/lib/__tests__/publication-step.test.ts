import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
const script = resolve("scripts/publication-step.mjs");
describe("publication command telemetry", () => {
  it("strips build credentials and records actual timing without external services", () => {
    const cwd = mkdtempSync(join(tmpdir(), "publication-step-"));
    try {
      const result = spawnSync(
        process.execPath,
        [
          script,
          "web-build",
          "-",
          "local",
          process.execPath,
          "-e",
          "process.exit(process.env.CLOUDFLARE_API_TOKEN || process.env.GITHUB_TOKEN || process.env.MISE_GITHUB_TOKEN ? 2 : 0)",
        ],
        {
          cwd,
          env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: "dummy",
            GITHUB_TOKEN: "dummy",
            MISE_GITHUB_TOKEN: "dummy",
          },
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(0);
      const event = JSON.parse(
        readFileSync(join(cwd, ".artifacts/publication-timings.jsonl"), "utf8"),
      );
      expect(event).toMatchObject({ name: "web-build", state: "completed" });
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("preserves failure exit codes and creates an attributable error event", () => {
    const cwd = mkdtempSync(join(tmpdir(), "publication-step-"));
    try {
      const result = spawnSync(
        process.execPath,
        [script, "web-deploy", "-", "local", process.execPath, "-e", "process.exit(7)"],
        { cwd, encoding: "utf8" },
      );
      expect(result.status).toBe(7);
      expect(
        JSON.parse(readFileSync(join(cwd, ".artifacts/publication-failure.json"), "utf8")),
      ).toMatchObject({ name: "web-deploy", state: "failed" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
