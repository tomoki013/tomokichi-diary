import { fromD1, type D1Like } from "@tomokichi/infra-d1";

export interface McpAuditContext {
  actorType: "remote-analytics" | "remote-operator";
  actorSubject: string;
  clientId?: string;
  clientName?: string;
  clientRedirectHost?: string;
  clientTrust: "confirmed" | "self-asserted" | "unknown";
  oauthGrantRef?: string;
}

export interface McpAudit {
  start(toolName: string, requestId?: string): Promise<string>;
  finish(id: string, success: boolean): Promise<void>;
}

async function clientHash(clientId: string | undefined): Promise<string | null> {
  if (!clientId) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function createMcpAudit(db: D1Like, context: McpAuditContext): McpAudit {
  const sql = fromD1(db);
  return {
    async start(toolName: string, requestId?: string): Promise<string> {
      const id = crypto.randomUUID();
      await sql
        .prepare(
          `INSERT INTO operator_audit_events
           (id,occurred_at,request_id,actor_type,actor_subject,client_id,client_name,client_trust,source,
            action,target_type,target_id,result,status_code,metadata,oauth_grant_ref,mcp_tool_name,publication_id,client_redirect_host)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          new Date().toISOString(),
          requestId ?? id,
          context.actorType,
          context.actorSubject,
          await clientHash(context.clientId),
          context.clientName?.slice(0, 120) ?? null,
          context.clientTrust,
          "remote-mcp",
          `mcp.tool.${toolName}`,
          context.actorType === "remote-analytics" ? "analytics" : "operator-tool",
          null,
          "requested",
          null,
          "{}",
          context.oauthGrantRef ?? null,
          toolName.slice(0, 100),
          null,
          context.clientRedirectHost ?? null,
        )
        .run();
      return id;
    },
    async finish(id: string, success: boolean): Promise<void> {
      await sql
        .prepare("UPDATE operator_audit_events SET result=?,status_code=? WHERE id=?")
        .bind(success ? "succeeded" : "failed", success ? 200 : 500, id)
        .run();
    },
  };
}
