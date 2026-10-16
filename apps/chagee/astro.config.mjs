// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// The CHAGEE guide is a separate site from the travel blog: its own Worker, D1
// database and R2 bucket, and no imports from @tomokichi/* packages. Pages are
// rendered on request from D1 so news and menu updates go live without a build.
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://chagee.tomokichidiary.com",
  output: "server",
  trailingSlash: "never",
  adapter: cloudflare({
    // No Cloudflare Images binding: photos are pre-sized WebP in R2.
    imageService: "passthrough",
  }),
  // Nothing on the site needs a server-side session.
  session: false,
  devToolbar: { enabled: false },
  security: { checkOrigin: true },
});
