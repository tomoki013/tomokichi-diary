import type { APIRoute } from "astro";
import { escapeHtml } from "../../lib/markdown";
import { repo } from "../../lib/repo";
import { absoluteUrl } from "../../lib/seo";
import { SITE } from "../../lib/site";

export const GET: APIRoute = async () => {
  const items = await repo().news(30);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeHtml(`${SITE.name}（非公式） 最新情報`)}</title>
<link>${absoluteUrl("/news")}</link>
<description>${escapeHtml(SITE.description)}</description>
<language>ja</language>
${items
  .map(
    (item) => `<item>
<title>${escapeHtml(item.title)}</title>
<link>${absoluteUrl(`/news/${item.slug}`)}</link>
<guid>${absoluteUrl(`/news/${item.slug}`)}</guid>
<pubDate>${new Date(`${item.publishedAt.slice(0, 10)}T00:00:00+09:00`).toUTCString()}</pubDate>
<description>${escapeHtml(item.summary)}</description>
</item>`,
  )
  .join("\n")}
</channel>
</rss>`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
};
