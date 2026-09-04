import type { APIRoute } from "astro";
import { content } from "../lib/content";

export const prerender = true;

export const GET: APIRoute = () => {
  const records = content.publicArticles().flatMap((article) => {
    if (article.kind !== "article") return [];
    const view = content.viewOf(article.id);
    if (!view) return [];
    return [
      {
        title: view.revision.title,
        summary: view.revision.summary,
        url: view.route.path,
        publishedAt: view.article.publishedAt?.slice(0, 10) ?? "",
        categories: view.categories.map((item) => item.name),
        locations: view.locations.map(({ location }) =>
          content.locations.nameOf(location.id, "ja"),
        ),
      },
    ];
  });

  return new Response(JSON.stringify(records), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
