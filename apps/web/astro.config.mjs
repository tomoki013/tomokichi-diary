// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { routeArtifacts } from "./src/integrations/route-artifacts.ts";
import { snapshot } from "./src/lib/content.ts";

const site = process.env.PUBLIC_SITE_URL ?? "https://tomokichidiary.com";

// Static-first: every public page is generated at build time from the content
// snapshot in `export/` (see docs/adr/0006-build-time-content-snapshot.md).
export default defineConfig({
  site,
  output: "static",
  // The previous site served every URL without a trailing slash and redirected
  // the slashed form to it. `file` output keeps that exact behaviour on
  // Cloudflare Pages; `directory` output would 308 in the opposite direction.
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [react(), routeArtifacts(snapshot.routes)],
  devToolbar: { enabled: false },
});
