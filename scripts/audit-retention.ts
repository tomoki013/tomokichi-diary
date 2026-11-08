import type { SqlDatabase } from "@tomokichi/infra-d1";
import { remoteDatabase } from "./lib/remote-db.js";

const minimumDays = 180;
const dayMs = 86_400_000;

export function auditRetentionCutoff(configured: string | undefined, now: Date): string {
  const value = configured?.trim() || String(minimumDays);
  const days = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(days) || days < minimumDays)
    throw new Error(`AUDIT_RETENTION_DAYS must be an integer of at least ${minimumDays}`);
  return new Date(now.getTime() - days * dayMs).toISOString();
}

export async function retainAuditEvents(db: SqlDatabase, cutoff: string, apply: boolean) {
  const row = await db
    .prepare("SELECT COUNT(*) AS eligible FROM operator_audit_events WHERE occurred_at < ?")
    .bind(cutoff)
    .first<{ eligible: number }>();
  if (!row || !Number.isSafeInteger(row.eligible) || row.eligible < 0)
    throw new Error("D1 did not return the number of eligible audit events");
  const { eligible } = row;
  if (apply && eligible > 0)
    await db.prepare("DELETE FROM operator_audit_events WHERE occurred_at < ?").bind(cutoff).run();
  return { cutoff, eligible, applied: apply };
}

if (import.meta.main) {
  const cutoff = auditRetentionCutoff(process.env.AUDIT_RETENTION_DAYS, new Date());
  const apply = process.argv.includes("--apply");
  console.log(await retainAuditEvents(remoteDatabase(), cutoff, apply));
}
