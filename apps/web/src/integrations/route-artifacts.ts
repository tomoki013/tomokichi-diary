import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { AstroIntegration } from "astro";
import type { Route } from "@tomokichi/domain";
import { mediaBaseUrl } from "../lib/site.js";

/**
 * Redirects are route data, not configuration: this emits Cloudflare's
 * `_redirects` from the same table the pages are generated from, so a URL can
 * never move without its redirect moving with it (instruction §31).
 */
export function routeArtifacts(routes: readonly Route[]): AstroIntegration {
  return {
    name: "tomokichi:route-artifacts",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);

        const redirects = routes
          .filter((route) => route.targetType === "redirect" && route.redirectTo !== null)
          .map((route) => `${route.path} ${route.redirectTo} ${route.redirectStatus ?? 301}`);

        // Media moved to object storage; the previous site's image URLs are
        // indexed and linked, so they are redirected rather than dropped.
        redirects.push(`/images/* ${mediaBaseUrl}/images/:splat 301`);
        writeFileSync(join(outDir, "_redirects"), `${redirects.join("\n")}\n`);

        // Workers static assets apply *every* matching rule and concatenate
        // the values, so Cache-Control is set only on the immutable paths.
        // HTML keeps the platform default (`max-age=0, must-revalidate`),
        // which is what makes a republish visible immediately.
        const headers = [
          "/_astro/*",
          "  Cache-Control: public, max-age=31536000, immutable",
          "/*",
          "  X-Content-Type-Options: nosniff",
          "  Referrer-Policy: strict-origin-when-cross-origin",
        ];
        writeFileSync(join(outDir, "_headers"), `${headers.join("\n")}\n`);

        logger.info(`wrote ${redirects.length} redirects`);
      },
    },
  };
}
