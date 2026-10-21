// Read-only Actions timing collection: queue/setup are observable before our commands start.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const root = ".artifacts";
mkdirSync(root, { recursive: true });
const rows = existsSync(`${root}/publication-timings.jsonl`)
  ? readFileSync(`${root}/publication-timings.jsonl`, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
  : [];
let actions = null;
if (process.env.GITHUB_RUN_ID && process.env.GITHUB_TOKEN) {
  const headers = {
    authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
  };
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const get = async (path) => {
    const response = await fetch(path, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Actions timing unavailable (HTTP ${response.status})`);
    return response.json();
  };
  try {
    const run = await get(url);
    const { jobs } = await get(`${url}/attempts/${process.env.GITHUB_RUN_ATTEMPT}/jobs`);
    const job = jobs.find((item) => item.name.toLowerCase() === process.env.GITHUB_JOB);
    actions = {
      runId: run.id,
      attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      url: run.html_url,
      createdAt: run.created_at,
      jobCreatedAt: job?.created_at ?? null,
      startedAt: job?.started_at ?? null,
      workflowToJobStartMs: job ? Date.parse(job.started_at) - Date.parse(run.created_at) : null,
      queueMs: job?.created_at ? Date.parse(job.started_at) - Date.parse(job.created_at) : null,
      steps: job?.steps ?? [],
    };
  } catch (error) {
    console.warn(error.message);
  }
}
const read = (name) =>
  existsSync(`${root}/${name}.json`)
    ? JSON.parse(readFileSync(`${root}/${name}.json`, "utf8"))
    : null;
const report = {
  recordedAt: new Date().toISOString(),
  actions,
  steps: rows,
  media: read("media-build"),
  sync: read("media-sync"),
  release: read("content-release"),
};
writeFileSync(`${root}/publication-report.json`, JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY && report.media)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `\nImages: ${report.media.cached} cached, ${report.media.restored} restored, ${report.media.generated} generated. R2: ${report.sync?.uploaded ?? "unavailable"} uploaded. MCP input comparison: see the conditional build/deploy steps.\n`,
  );
