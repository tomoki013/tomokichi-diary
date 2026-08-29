import type { APIRoute } from "astro";
import { renderRssXml } from "@tomokichi/seo";
import { isIndexable } from "@tomokichi/domain";
import { content, now } from "../lib/content";
import { seoConfig } from "../lib/site";

export const GET: APIRoute = () => {
  const items = content
    .publicArticles()
    .filter((article) => isIndexable(article, now))
    .slice(0, 50)
    .flatMap((article) => {
      const view = content.viewOf(article.id);
      return view
        ? [
            {
              title: view.revision.title,
              description: view.revision.summary,
              route: view.route,
              publishedAt: article.publishedAt ?? article.createdAt,
            },
          ]
        : [];
    });

  return new Response(renderRssXml(seoConfig, items), {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
};
