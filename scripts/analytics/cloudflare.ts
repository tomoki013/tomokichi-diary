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
