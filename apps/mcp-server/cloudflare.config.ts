import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "tomokichi-diary-mcp",
    compatibilityDate: "2026-08-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/index.ts",
    observability: { enabled: true },
    env: {
      OAUTH_KV: bindings.kv({ id: "4554c3ab766c40eabb06afcea5da8beb" }),
      DB: bindings.d1({ name: "tomokichi-diary", id: "b799453b-ada9-454e-81dc-26999c2c29db" }),
      API: bindings.worker({ worker: "tomokichi-diary-api" }),
      SITE_ORIGIN: bindings.text("https://tomokichidiary.com"),
    },
  },
});
