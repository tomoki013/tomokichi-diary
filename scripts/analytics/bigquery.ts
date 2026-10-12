import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dateRange, type DateRange } from "@tomokichi/application";
import { AnalyticsHttpError, requestJson } from "./http.js";

const project = "tomokichidiary-analytics";
export const SQL_NAMES = ["ga4", "gsc_site", "gsc_url", "ga4_available", "gsc_available"] as const;
export type SqlName = (typeof SQL_NAMES)[number];
export function queryConfig(name: SqlName, range: DateRange, extra: Record<string, string> = {}) {
  dateRange(range.start, range.end, 31);
  if (!SQL_NAMES.includes(name)) throw new Error("ANALYTICS_INVALID_QUERY");
  const maximumBytesBilled = process.env["ANALYTICS_MAX_BYTES"] ?? "1000000000";
  if (
    !/^\d+$/.test(maximumBytesBilled) ||
    BigInt(maximumBytesBilled) < 10000000n ||
    BigInt(maximumBytesBilled) > 10000000000n
  )
    throw new Error("ANALYTICS_INVALID_BUDGET");
  const property = process.env["ANALYTICS_GSC_PROPERTY"] ?? "https://tomokichidiary.com/";
  return {
    query: readFileSync(new URL(`./sql/${name}.sql`, import.meta.url), "utf8"),
    useLegacySql: false,
    maximumBytesBilled,
    parameterMode: "NAMED",
    queryParameters: Object.entries({ ...range, property, ...extra }).map(
      ([parameterName, value]) => ({
        name: parameterName,
        parameterType: { type: "STRING" },
        parameterValue: { value },
      }),
    ),
  };
}
interface BqJob {
  jobReference: { jobId: string };
  statistics?: { query?: { totalBytesProcessed?: string } };
  status?: { state: string; errorResult?: unknown };
}
interface BqResult {
  schema?: { fields: { name: string }[] };
  rows?: { f: { v: unknown }[] }[];
  pageToken?: string;
  totalRows?: string;
}
export function accessToken(): string {
  return execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export class BigQuery {
  constructor(private token: string) {}
  private headers() {
    return { authorization: `Bearer ${this.token}`, "content-type": "application/json" };
  }
  async query(name: SqlName, range: DateRange, dryRun = false, extra: Record<string, string> = {}) {
    const config = queryConfig(name, range, extra);
    const jobId = `diary_analytics_${randomUUID().replaceAll("-", "")}`;
    const body = JSON.stringify({
      jobReference: { projectId: project, location: "US", jobId },
      configuration: { dryRun, query: config },
    });
    const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${project}`;
    let job: BqJob;
    try {
      job = await requestJson<BqJob>(`${base}/jobs`, {
        method: "POST",
        headers: this.headers(),
        body,
      });
    } catch (e) {
      if (!(e instanceof AnalyticsHttpError) || e.status !== 409) throw e;
      job = await requestJson<BqJob>(`${base}/jobs/${jobId}?location=US`, {
        headers: this.headers(),
      });
    }
    const bytes = job.statistics?.query?.totalBytesProcessed;
    if (dryRun) {
      process.stdout.write(`${name}: estimated bytes ${bytes ?? "unknown"}\n`);
      return [];
    }
    for (let poll = 0; job.status?.state !== "DONE"; poll++) {
      if (poll >= 120) throw new Error("ANALYTICS_QUERY_TIMEOUT");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      job = await requestJson<BqJob>(`${base}/jobs/${jobId}?location=US`, {
        headers: this.headers(),
      });
    }
    if (job.status.errorResult) throw new Error("ANALYTICS_QUERY_FAILED");
    const output: Record<string, string | null>[] = [];
    let pageToken: string | undefined;
    let resultFields: { name: string }[] = [];
    do {
      const url = new URL(`${base}/queries/${jobId}`);
      url.searchParams.set("location", "US");
      url.searchParams.set("maxResults", "10000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const page = await requestJson<BqResult>(url.href, { headers: this.headers() });
      if (Number(page.totalRows ?? 0) > 250000) throw new Error("ANALYTICS_RESULT_TOO_LARGE");
      if (page.schema?.fields) resultFields = page.schema.fields;
      const fields = resultFields;
      for (const row of page.rows ?? [])
        output.push(
          Object.fromEntries(fields.map((field, i) => [field.name, row.f[i]?.v ?? null])) as Record<
            string,
            string | null
          >,
        );
      if (output.length > 250000) throw new Error("ANALYTICS_RESULT_TOO_LARGE");
      pageToken = page.pageToken;
    } while (pageToken);
    return output;
  }
}
