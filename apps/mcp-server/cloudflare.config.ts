import { bindings, defineConfig } from "cf/config";

// On the first rollout, publish OperatorConnections on the existing host
// before the API publishes McpConsentIdentity. Existing OAuth can keep running.
const bootstrapConsent = process.env.MCP_CONSENT_BOOTSTRAP === "1";

export default defineConfig({
  worker: {
    name: "tomokichi-diary-mcp",
    compatibilityDate: "2026-08-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/index.ts",
    workersDev: true,
    ...(bootstrapConsent ? {} : { domains: ["mcp.tomokichidiary.com"] }),
    observability: { enabled: true },
    env: {
      OAUTH_REGISTRATION_LIMITER: bindings.rateLimit({
        namespace: "3002",
        simple: { limit: 30, period: 60 },
      }),
      OAUTH_KV: bindings.kv({ id: "4554c3ab766c40eabb06afcea5da8beb" }),
      DB: bindings.d1({ name: "tomokichi-diary", id: "b799453b-ada9-454e-81dc-26999c2c29db" }),
      API: bindings.worker({ worker: "tomokichi-diary-api" }),
      ...(bootstrapConsent
        ? {}
        : {
            CONSENT_IDENTITY: bindings.worker({
              worker: "tomokichi-diary-api",
              exportName: "McpConsentIdentity",
              props: { caller: "tomokichi-diary-mcp" },
            }),
          }),
      // The remote operator's door to /v1/admin/*: a named entrypoint with no
      // public URL, so this Worker never holds the admin token. The API checks
      // `caller` (apps/api/src/operator.ts).
      OPERATOR_API: bindings.worker({
        worker: "tomokichi-diary-api",
        exportName: "AdminOperator",
        props: { caller: "tomokichi-diary-mcp" },
      }),
      SITE_ORIGIN: bindings.text("https://tomokichidiary.com"),
    },
  },
});
