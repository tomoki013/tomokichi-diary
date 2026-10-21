import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { mcpFingerprint } from "../publication-mcp.js";

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}
const workflow = (name: string) => parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
describe("publication workflow invariants", () => {
  it("serializes content and code deployments and keeps scheduled recovery", () => {
    const publish = workflow("publish");
    const ci = workflow("ci");
    expect(publish.concurrency).toEqual(ci.jobs.deploy.concurrency);
    expect(publish.concurrency["cancel-in-progress"]).toBe(false);
    expect(publish.on.schedule).toHaveLength(1);
    expect(publish.jobs.publish.if).toContain("refs/heads/main");
  });
  it("builds only web and conditionally the actual MCP inputs, and verifies before completion", () => {
    const steps = workflow("publish").jobs.publish.steps as Step[];
    const commands = steps.map((step) => step.run ?? "").join("\n");
    expect(commands).toContain("--filter @tomokichi/web build");
    expect(commands).not.toMatch(/pnpm build(?:\s|$)/);
    expect(commands).toContain("pnpm content:check");
    for (const entry of steps.filter((step) => /mcp-(build|deploy)/.test(step.run ?? "")))
      expect(entry.if).toContain("mcp_changed");
    const verify = steps.findIndex((step) => step.run?.endsWith("content-release.ts verify"));
    const complete = steps.findIndex((step) => step.run?.endsWith("content-release.ts complete"));
    expect(verify).toBeGreaterThan(0);
    expect(complete).toBeGreaterThan(verify);
    expect(steps.find((step) => step.name === "Install dependencies")?.env).toBeUndefined();
    expect(steps.find((step) => step.name === "Build static web only")?.run).toContain(
      "site local",
    );
  });
  it("saves a new cache including originals after each build without using Git media metadata", () => {
    const steps = workflow("publish").jobs.publish.steps as Step[];
    const restore = steps.find((step) => step.uses === "actions/cache/restore@v6");
    const save = steps.find((step) => step.uses === "actions/cache/save@v6");
    expect(restore?.with?.path).toContain("publication-originals");
    expect(restore?.with?.key).not.toContain("export/media.json");
    expect(save?.with?.key).toContain("steps.content.outputs.media_key");
    expect(save?.with?.key).toContain("github.run_attempt");
    expect(save?.if).toContain("always()");
  });
  it("has a stable MCP fingerprint excluding generated build products", () => {
    expect(mcpFingerprint()).toBe(mcpFingerprint());
    expect(mcpFingerprint()).toMatch(/^[a-f0-9]{64}$/);
  });
});
