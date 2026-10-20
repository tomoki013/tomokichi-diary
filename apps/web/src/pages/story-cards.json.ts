import type { APIRoute } from "astro";
import { content } from "../lib/content";
import { cardImageUrl } from "../lib/images";

export const prerender = true;

/**
 * Title and cover of every public story, for lists the browser builds itself
 * (the home page's "いいねした旅"). The same file for every reader: the shelf
 * is matched against it in the browser, so nothing about what a reader saved
 * is ever sent to ask for it. A story that is unpublished or removed drops
 * out of this file, and with it out of those lists.
 */
export const GET: APIRoute = () => {
  const records = content.publicArticles().flatMap((article) => {
    if (article.kind !== "article") return [];
    const view = content.viewOf(article.id);
    if (!view) return [];
    return [
      {
        url: view.route.path,
        title: view.revision.title,
        image: view.cover ? cardImageUrl(view.cover.asset.storageKey) : null,
      },
    ];
  });

  return new Response(JSON.stringify(records), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
