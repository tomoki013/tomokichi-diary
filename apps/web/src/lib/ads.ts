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
      observer.disconnect();
      const script = doc.createElement("script");
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
