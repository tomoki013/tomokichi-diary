import { appendFileSync, mkdirSync } from "node:fs";

export async function timed<T>(name: string, action: () => Promise<T>): Promise<T> {
  mkdirSync(".artifacts", { recursive: true });
  const startedAt = new Date().toISOString();
  const start = performance.now();
  process.stdout.write(`[publication] ${name} start ${startedAt}\n`);
  let state = "completed";
  try {
    return await action();
  } catch (error) {
    state = "failed";
    throw error;
  } finally {
    const result = {
      name,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start),
      state,
    };
    appendFileSync(".artifacts/publication-timings.jsonl", `${JSON.stringify(result)}\n`);
    process.stdout.write(
      `[publication] ${name} ${state} ${result.finishedAt} ${result.durationMs}ms\n`,
    );
  }
}
