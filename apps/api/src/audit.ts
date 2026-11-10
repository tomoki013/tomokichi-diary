import type { SqlDatabase } from "@tomokichi/infra-d1";

export type AuditSource = "admin" | "remote-mcp" | "local-mcp" | "system";
export type AuditTrust = "confirmed" | "self-asserted" | "unknown";

export interface AuditContext {
  actorType: string;
  actorSubject: string | null;
  source: AuditSource;
  clientId?: string;
  clientName?: string;
  clientRedirectHost?: string;
  clientTrust: AuditTrust;
  oauthGrantRef?: string;
  mcpToolName?: string;
  operatorWrite?: boolean;
}

const clean = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined;

/** Only called by the private AdminOperator entrypoint after checking its binding caller. */
export function parseOperatorAuditContext(request: Request): AuditContext | undefined {
  const raw = request.headers.get("x-operator-audit-context");
  if (!raw || raw.length > 2048) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const actorType = value["actorType"];
    if (actorType !== "remote-operator" && actorType !== "remote-analytics") return undefined;
    const subject = clean(value["actorSubject"], 160);
    if (!subject) return undefined;
    const trust = value["clientTrust"];
    return {
      actorType,
      actorSubject: subject,
      source: "remote-mcp",
      clientId: clean(value["clientId"], 64),
      clientName: clean(value["clientName"], 120),
      clientRedirectHost: clean(value["clientRedirectHost"], 253),
      clientTrust: trust === "confirmed" || trust === "self-asserted" ? trust : "unknown",
      oauthGrantRef: clean(value["oauthGrantRef"], 80),
      mcpToolName: clean(value["mcpToolName"], 100),
      // Analytics connections are read-only whatever they claim.
      operatorWrite: actorType === "remote-operator" && value["operatorWrite"] === true,
    };
  } catch {
    return undefined;
  }
}

export interface AuditEventInput extends AuditContext {
  id: string;
  occurredAt: string;
  requestId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: "requested" | "succeeded" | "failed" | "rejected";
  statusCode: number | null;
  metadata: Record<string, unknown>;
  publicationId?: string;
}

/** Insert first so a failed audit store blocks the operation before it mutates state. */
export async function insertAuditEvent(db: SqlDatabase, event: AuditEventInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO operator_audit_events
       (id,occurred_at,request_id,actor_type,actor_subject,client_id,client_name,client_trust,source,
        action,target_type,target_id,result,status_code,metadata,oauth_grant_ref,mcp_tool_name,publication_id,client_redirect_host)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      event.id,
      event.occurredAt,
      event.requestId,
      event.actorType,
      event.actorSubject,
      event.clientId ?? null,
      event.clientName ?? null,
      event.clientTrust,
      event.source,
      event.action,
      event.targetType,
      event.targetId,
      event.result,
      event.statusCode,
      JSON.stringify(event.metadata),
      event.oauthGrantRef ?? null,
      event.mcpToolName ?? null,
      event.publicationId ?? null,
      event.clientRedirectHost ?? null,
    )
    .run();
}

export async function finishAuditEvent(
  db: SqlDatabase,
  id: string,
  result: AuditEventInput["result"],
  statusCode: number,
  publicationId?: string,
  targetId?: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE operator_audit_events SET result=?, status_code=?, publication_id=?, target_id=COALESCE(?,target_id) WHERE id=?",
    )
    .bind(result, statusCode, publicationId ?? null, targetId ?? null, id)
    .run();
}
