import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromNodeSqlite, openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import { auditRetentionCutoff, retainAuditEvents } from "../../audit-retention.js";

describe("audit retention", () => {
  const now = new Date("2026-11-08T06:00:00.000Z");

  it("defaults to 180 days and rejects values below the minimum", () => {
    expect(auditRetentionCutoff(undefined, now)).toBe("2026-05-12T06:00:00.000Z");
    expect(auditRetentionCutoff("365", now)).toBe("2025-11-08T06:00:00.000Z");
    for (const invalid of ["179", "180.5", "180 days"])
      expect(() => auditRetentionCutoff(invalid, now)).toThrow(/at least 180/);
  });

  it("only removes expired rows on apply and retains events exactly at the cutoff", async () => {
    const raw = openInMemoryDatabase();
    const db = fromNodeSqlite(raw);
    await db.exec(readFileSync("migrations/0027_operator_audit_events.sql", "utf8"));
    const cutoff = auditRetentionCutoff("180", now);
    const insert = db.prepare(
      `INSERT INTO operator_audit_events
       (id,occurred_at,request_id,actor_type,client_trust,source,action,result)
       VALUES (?,?,'test','system','unknown','system','test','succeeded')`,
    );
    await insert.bind("expired", "2026-05-12T05:59:59.999Z").run();
    await insert.bind("at-cutoff", cutoff).run();
    await insert.bind("new", now.toISOString()).run();
    expect(await retainAuditEvents(db, cutoff, false)).toEqual({
      cutoff,
      eligible: 1,
      applied: false,
    });
    const ids = () => db.prepare("SELECT id FROM operator_audit_events ORDER BY id").all();
    expect(await ids()).toEqual([{ id: "at-cutoff" }, { id: "expired" }, { id: "new" }]);
    expect(await retainAuditEvents(db, cutoff, true)).toEqual({
      cutoff,
      eligible: 1,
      applied: true,
    });
    expect(await ids()).toEqual([{ id: "at-cutoff" }, { id: "new" }]);
    expect((await retainAuditEvents(db, cutoff, true)).eligible).toBe(0);
  });
});
