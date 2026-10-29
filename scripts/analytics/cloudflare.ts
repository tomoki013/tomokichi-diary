import { readFileSync } from "node:fs";
import type { Route } from "@tomokichi/domain";
import { requestJson } from "./http.js";
export interface Statement {
  sql: string;
  params?: unknown[];
}
const DATABASE = "b799453b-ada9-454e-81dc-26999c2c29db";
export async function d1<T = Record<string, unknown>>(statements: Statement[]): Promise<T[][]> {
  const token = process.env["CLOUDFLARE_API_TOKEN"],
    account = process.env["CLOUDFLARE_ACCOUNT_ID"];
  if (!token || !account || !/^[a-f0-9]{32}$/.test(account))
    throw new Error("ANALYTICS_D1_UNCONFIGURED");
  const response = await requestJson<{
    success: boolean;
    result: { success: boolean; results: T[] }[];
  }>(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DATABASE}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ batch: statements }),
  });
  if (!response.success || response.result.some((r) => !r.success))
    throw new Error("ANALYTICS_D1_FAILED");
  return response.result.map((r) => r.results);
}
/** Live routes when writing to D1; the committed export for dry runs. */
export async function loadRoutes(persist: boolean): Promise<Route[]> {
  if (!persist) return JSON.parse(readFileSync("export/routes.json", "utf8")) as Route[];
  const [rows] = await d1<{
    id: string;
    path: string;
    locale: string;
    target_type: string;
    target_id: string | null;
    is_canonical: number;
    redirect_to: string | null;
    redirect_status: number | null;
    is_legacy: number;
    noindex: number;
  }>([{ sql: "SELECT * FROM routes" }]);
  return rows!.map((r) => ({
    id: r.id,
    path: r.path,
    locale: r.locale,
    targetType: r.target_type,
    targetId: r.target_id,
    isCanonical: Boolean(r.is_canonical),
    redirectTo: r.redirect_to,
    redirectStatus: r.redirect_status,
    isLegacy: Boolean(r.is_legacy),
    noindex: Boolean(r.noindex),
  })) as Route[];
}
