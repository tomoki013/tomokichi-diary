import type { APIRoute } from "astro";
import { ORDER_GUIDES } from "../lib/order-guide";
import { repo } from "../lib/repo";
import { absoluteUrl } from "../lib/seo";

const STATIC = [
  "/",
  "/menu",
  "/order",
  "/stores",
  "/news",
  "/columns",
  "/about",
  "/policy",
  "/contact",
];

export const GET: APIRoute = async () => {
  const data = repo();
  const [menus, stores, news] = await Promise.all([data.menus(), data.stores(), data.news()]);
  const entries: { path: string; lastmod?: string }[] = [
    ...STATIC.map((path) => ({ path })),
    ...ORDER_GUIDES.filter((g) => g.ready).map((g) => ({ path: `/order/${g.slug}` })),
    ...menus.map((m) => ({ path: `/menu/${m.slug}`, lastmod: m.updatedAt })),
    ...stores.map((s) => ({ path: `/stores/${s.slug}`, lastmod: s.updatedAt })),
    ...news.map((n) => ({ path: `/news/${n.slug}`, lastmod: n.updatedAt })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `<url><loc>${absoluteUrl(e.path)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
