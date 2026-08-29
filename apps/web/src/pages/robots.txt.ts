import type { APIRoute } from "astro";
import { renderRobotsTxt } from "@tomokichi/seo";
import { seoConfig } from "../lib/site";

export const GET: APIRoute = () =>
  new Response(renderRobotsTxt(seoConfig, { disallow: ["/admin"] }), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
