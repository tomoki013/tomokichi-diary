// Pure Node: usable before pnpm install, and never requires Cloudflare for local checks.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
const [name, stage, access, command, ...args] = process.argv.slice(2);
if (!name || !stage || !["local", "remote"].includes(access) || !command)
  throw new Error(
    "Usage: publication-step.mjs <name> <stage|-> <local|remote> <command> [...args]",
  );
mkdirSync(".artifacts", { recursive: true });
const startedAt = new Date().toISOString();
const started = performance.now();
const timing = ".artifacts/publication-timings.jsonl";
const progress = async (state) => {
  if (stage === "-" || !existsSync(".artifacts/content-release.json")) return;
  const code = await execute(
    process.execPath,
    ["--import", "tsx", "scripts/content-release.ts", "progress", stage, state],
    process.env,
  );
  if (code !== 0) throw new Error("Could not record publication progress");
};
function execute(bin, argv, env) {
  return new Promise((resolve) => {
    const child = spawn(bin, argv, { env, stdio: "inherit" });
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}
let code = 1;
process.stdout.write(`[publication] ${name} start ${startedAt}\n`);
try {
  await progress("running");
  const env = { ...process.env };
  if (access === "local") {
    for (const key of Object.keys(env))
      if (/^(CLOUDFLARE_|GITHUB_TOKEN$|GITHUB_PUBLISH_TOKEN$|MISE_GITHUB_TOKEN$)/.test(key))
        delete env[key];
  }
  code = await execute(command, args, env);
  await progress(code === 0 ? "completed" : "failed");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  code = 1;
}
const result = {
  name,
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Math.round(performance.now() - started),
  state: code === 0 ? "completed" : "failed",
};
appendFileSync(timing, `${JSON.stringify(result)}\n`);
if (code !== 0) writeFileSync(".artifacts/publication-failure.json", JSON.stringify(result));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `| ${name} | ${result.state} | ${(result.durationMs / 1000).toFixed(2)}s |\n`,
  );
process.stdout.write(
  `[publication] ${name} ${result.state} ${result.finishedAt} ${result.durationMs}ms\n`,
);
process.exitCode = code;
