import { measureReader } from "./readerMeasurement";

declare global {
  var adsbygoogle: Record<string, unknown>[] | undefined;
  var googlefc: { callbackQueue?: (() => void)[]; showRevocationMessage?: () => void } | undefined;
}

/** One fixed ad after the story. Google handles the site's published CMP message. */
export function mountArticleAd(
  slot: HTMLElement,
  doc: Document = document,
  browser: typeof globalThis = globalThis,
): void {
  if (
    !["tomokichidiary.com", "www.tomokichidiary.com"].includes(browser.location.hostname) ||
    !browser.IntersectionObserver ||
    slot.dataset["adMounted"]
  )
    return;
  slot.dataset["adMounted"] = "1";
  const ad = slot.querySelector<HTMLElement>(".adsbygoogle");
  if (!ad?.dataset["adClient"] || !ad.dataset["adSlot"]) return;
  measureReader("ad_eligible", 1, "article_end");
  let statusSent = false;
  const status = new browser.MutationObserver(() => {
    const value = ad.dataset["adStatus"];
    if (statusSent || !["filled", "unfilled"].includes(value ?? "")) return;
    statusSent = true;
    measureReader(value === "filled" ? "ad_filled" : "ad_unfilled", 1, "article_end");
    status.disconnect();
    updateView();
  });
  status.observe(ad, { attributes: true, attributeFilter: ["data-ad-status"] });
  let halfVisible = false,
    viewSent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const updateView = () => {
    if (timer) {
      browser.clearTimeout(timer);
      timer = undefined;
    }
    if (
      viewSent ||
      !halfVisible ||
      doc.visibilityState === "hidden" ||
      ad.dataset["adStatus"] !== "filled"
    )
      return;
    timer = browser.setTimeout(() => {
      viewSent = true;
      measureReader("ad_viewable_proxy", 1, "article_end");
      view.disconnect();
    }, 1000);
  };
  const view = new browser.IntersectionObserver(
    (entries) => {
      halfVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      updateView();
    },
    { threshold: [0, 0.5] },
  );
  view.observe(ad);
  doc.addEventListener("visibilitychange", updateView);
  browser.addEventListener("pagehide", () => {
    if (timer) browser.clearTimeout(timer);
  });
  let requested = false;
  const observer = new browser.IntersectionObserver(
    (entries) => {
      if (
        requested ||
        !entries.some((entry) => entry.isIntersecting) ||
        slot.getBoundingClientRect().width < 300 ||
        doc.visibilityState === "hidden"
      )
        return;
      requested = true;
      measureReader("ad_request", 1, "article_end");
      observer.disconnect();
      const script = doc.createElement("script");
      script.addEventListener("error", () => measureReader("ad_script_error", 1, "article_end"), {
        once: true,
      });
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ad.dataset["adClient"]}`;
      script.addEventListener(
        "load",
        () => {
          browser.adsbygoogle ??= [];
          browser.adsbygoogle.push({});
        },
        { once: true },
      );
      // Ad blockers, unavailable inventory and network failures leave the
      // reserved space alone; nothing retries or pushes the article around.
      doc.head.append(script);
    },
    { rootMargin: "200px 0px", threshold: 0 },
  );
  const observe = () => observer.observe(slot);
  if (doc.readyState === "complete") observe();
  else browser.addEventListener("load", observe, { once: true });

  slot.querySelector<HTMLAnchorElement>("[data-ad-privacy]")?.addEventListener("click", (event) => {
    const fc = browser.googlefc;
    if (!fc?.showRevocationMessage) return; // The cookie policy remains a usable fallback.
    event.preventDefault();
    fc.callbackQueue ??= [];
    fc.callbackQueue.push(() => fc.showRevocationMessage?.());
  });
}
