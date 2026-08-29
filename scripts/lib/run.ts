import { spawn } from "node:child_process";

export interface CommandOutcome {
  ok: boolean;
  code: number;
  /** stdout and stderr interleaved, kept for the artifact — never printed wholesale. */
  output: string;
}

/** Runs a command capturing all output; nothing reaches stdout unless the caller prints it. */
export function run(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) =>
      resolve({ ok: false, code: 1, output: `${output}${error.message}` }),
    );
    child.on("close", (code) => resolve({ ok: code === 0, code: code ?? 1, output }));
  });
}

/** Last `count` non-empty lines — enough to identify a failure without dumping a build log. */
export function tail(output: string, count = 20): string {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-count)
    .join("\n");
}
