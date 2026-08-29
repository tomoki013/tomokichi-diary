/** Placeholder until the corresponding phase lands; reports as skipped, never as a pass. */
const payload = { skipped: true, reason: "not implemented yet" };
if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(payload)}\n`);
else process.stdout.write("- check-links: not implemented yet\n");
