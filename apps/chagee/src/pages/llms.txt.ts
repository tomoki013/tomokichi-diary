import type { APIRoute } from "astro";
import { COUNTRY_LABEL } from "../lib/labels";
import { ORDER_GUIDES } from "../lib/order-guide";
import { repo } from "../lib/repo";
import { absoluteUrl } from "../lib/seo";
import { SITE } from "../lib/site";

/** A plain-text map of the site for language models (llmstxt.org). Public data only. */
export const GET: APIRoute = async () => {
  const data = repo();
  const [menus, stores, news] = await Promise.all([data.menus(), data.stores(), data.news(20)]);
  const lines = [
    `# ${SITE.name}（${SITE.nameEn}）`,
    "",
    `> ${SITE.description}`,
    "",
    SITE.disclaimer,
    "体験レビュー（運営者の感想）と事実情報は区別して掲載しています。最新情報は 公式発表 / 報道ベース / 噂・未確認 のラベル付きです。",
    "",
    "## メニュー",
    ...menus.map(
      (m) =>
        `- [${m.nameJa}（${m.nameZh} / ${m.nameEn}）](${absoluteUrl(`/menu/${m.slug}`)}): ${m.shortDescription}`,
    ),
    "",
    "## 注文ガイド",
    ...ORDER_GUIDES.filter((g) => g.ready).map(
      (g) => `- [${COUNTRY_LABEL[g.country]}](${absoluteUrl(`/order/${g.slug}`)}): ${g.method}`,
    ),
    "",
    "## 店舗（運営者が実際に訪問）",
    ...stores.map(
      (s) =>
        `- [${s.name}](${absoluteUrl(`/stores/${s.slug}`)}): ${COUNTRY_LABEL[s.country]}・${s.city}・${s.area}`,
    ),
    "",
    "## 最新情報",
    ...news.map((n) => `- [${n.title}](${absoluteUrl(`/news/${n.slug}`)}): ${n.summary}`),
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
