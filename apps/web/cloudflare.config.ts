import { defineConfig } from "cf/config";

// A static-asset Worker: no entrypoint, so requests are served straight from the
// edge with no Worker invocation and no per-request cost. The build output
// directory is set in wrangler.config.ts.
export default defineConfig({
  worker: {
    name: "tomokichi-diary-web",
    compatibilityDate: "2026-08-01",
    observability: { enabled: true },
    assets: {
      // `_redirects` and `_headers` in the build output are honoured here, so the
      // route table still drives every redirect (see the route-artifacts
      // integration).
      notFoundHandling: "404-page",
      // The previous site served every URL without a trailing slash and
      // redirected the slashed form to it.
      htmlHandling: "drop-trailing-slash",
    },
  },
});
