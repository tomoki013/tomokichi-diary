import type { SemanticEvent } from "@tomokichi/application";
import { trackSemanticEvent } from "./analytics";

interface AffiliateTracking {
  key: string;
  provider: string;
  url: string;
  trackingOfferId?: string;
}

const mounted = new WeakSet<Document>();
const ownDomains = new Set([
  "tomokichidiary.com",
  "www.tomokichidiary.com",
  "chagee.tomokichidiary.com",
]);

export function mountArticleLinkTracking(doc: Document = document): void {
  const article = doc.querySelector<HTMLElement>("[data-article-slug]");
  const body = article?.querySelector<HTMLElement>(".article-content");
  const source = article?.dataset["articleSlug"];
  if (!article || !body || !source || mounted.has(doc)) return;
  mounted.add(doc);
  const affiliates = JSON.parse(
    article.dataset["affiliateTracking"] ?? "[]",
  ) as AffiliateTracking[];
  const location = new URL(doc.URL);
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    const url = new URL(link.href, location);
    if (link.relList.contains("sponsored")) {
      const key = link.closest<HTMLElement>("[data-affiliate-placement]")?.dataset[
        "affiliatePlacement"
      ];
      const matches = affiliates.filter((p) => new URL(p.url).href === url.href);
      const placement = key ? matches.find((p) => p.key === key) : undefined;
      const match = placement ?? (matches.length === 1 ? matches[0] : undefined);
      if (match) {
        trackSemanticEvent({
          name: "affiliate_click",
          source_slug: source,
          provider: match.provider,
          placement_id: match.key,
          ...(match.trackingOfferId ? { offer_id: match.trackingOfferId } : {}),
        });
      }
      return;
    }
    if (!body.contains(link) || url.pathname === location.pathname) return;
    if (
      url.origin !== location.origin &&
      !(
        url.protocol === "https:" &&
        ownDomains.has(url.hostname) &&
        ownDomains.has(location.hostname)
      )
    )
      return;
    const bounds = body.getBoundingClientRect();
    const fraction = (link.getBoundingClientRect().top - bounds.top) / Math.max(1, bounds.height);
    trackSemanticEvent({
      name: "internal_link_click",
      source_slug: source,
      destination_slug: url.pathname.replace(/\/+$/, "").split("/").at(-1) || "home",
      body_position: fraction < 1 / 3 ? "intro" : fraction < 2 / 3 ? "middle" : "end",
    });
  };
  article.addEventListener("click", onClick);
  article.addEventListener("auxclick", onClick);
}

type AdSlotEvent = Extract<SemanticEvent, { name: "ad_slot_rendered" }>;

export function trackAdSlotRendered(
  doc: Document,
  slot: AdSlotEvent["slot_type"],
  status: AdSlotEvent["ad_status"],
): void {
  const source = doc.querySelector<HTMLElement>("[data-article-slug]")?.dataset["articleSlug"];
  if (source)
    trackSemanticEvent({
      name: "ad_slot_rendered",
      source_slug: source,
      slot_type: slot,
      ad_status: status,
    });
}
