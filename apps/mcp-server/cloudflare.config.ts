import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "tomokichi-diary-mcp",
    compatibilityDate: "2026-08-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/index.ts",
    observability: { enabled: true },
    env: {
      SITE_ORIGIN: bindings.text("https://tomokichidiary.com"),
    },
  },
});
