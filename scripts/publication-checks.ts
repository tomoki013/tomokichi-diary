import { run } from "./lib/run.js";
import { timed } from "./lib/publication-timing.js";

// These validators read the same immutable build/snapshot and never modify it.
// Keep each existing validator intact while overlapping their process startup and I/O.
const checks = ["articles", "routes", "seo", "links", "knowledge", "agents"];
const results = await Promise.all(
  checks.map((name) =>
    timed(`check-${name}`, async () => {
      const result = await run(process.execPath, [
        "--import",
        "tsx",
        `scripts/check-${name === "agents" ? "agent-surfaces" : name}.ts`,
        ...(name === "agents" ? ["--web-only"] : []),
      ]);
      process.stdout.write(result.output);
      return result.ok;
    }),
  ),
);
if (results.some((ok) => !ok)) process.exitCode = 1;
