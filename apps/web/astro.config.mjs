// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

const site = process.env.PUBLIC_SITE_URL ?? "https://tomokichidiary.com";

// Static-first: every public page is generated at build time from the content
// snapshot in `export/` (see docs/adr/0006-build-time-content-snapshot.md).
export default defineConfig({
  site,
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [react()],
  devToolbar: { enabled: false },
});
