import type { APIRoute } from "astro";
import { buildSitemap, renderSitemapXml } from "@tomokichi/seo";
import { isIndexable } from "@tomokichi/domain";
import { content, now } from "../lib/content";
import { seoConfig } from "../lib/site";

/**
 * Generated from the route table and publication state, so a page can never be
 * listed here while carrying a noindex tag (instruction §34).
 */
export const GET: APIRoute = () => {
  const entries = buildSitemap(
    seoConfig,
    content.routes.renderable().map((route) => {
      const article =
        route.targetType === "article" || route.targetType === "static"
          ? content.snapshot.articles.find((candidate) => candidate.id === route.targetId)
          : undefined;

      return {
        route,
        lastmod: article?.updatedAt ?? content.snapshot.generatedAt,
        indexable: article ? isIndexable(article, now) : true,
      };
    }),
  );

  return new Response(renderSitemapXml(entries), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
};
