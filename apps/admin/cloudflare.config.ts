import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "tomokichi-diary-admin",
    compatibilityDate: "2026-08-01",
    entrypoint: "worker/index.ts",
    // No workers.dev URL: it would sit outside Cloudflare Access and outside the
    // custom domain, which is exactly the door this is meant to close.
    workersDev: false,
    observability: { enabled: true },
    // One hostname for the UI and the API it talks to, so a single Cloudflare
    // Access application protects both and the calls stay same-origin.
    domains: ["admin.tomokichidiary.com"],
    // A single-page app: every unknown path renders index.html and the hash
    // router takes over. The build output directory is set in wrangler.config.ts.
    assets: { notFoundHandling: "single-page-application" },
    env: {
      ASSETS: bindings.assets(),
      // The API is reached over the internal network, never over the internet.
      API: bindings.worker({ worker: "tomokichi-diary-api" }),
    },
  },
});
