import { ANCHOR_AD_EXPERIMENT } from "@tomokichi/contracts";
import { measureReader } from "./readerMeasurement";

declare global {
  var adsbygoogle: Record<string, unknown>[] | undefined;
  var googlefc: { callbackQueue?: (() => void)[]; showRevocationMessage?: () => void } | undefined;
}

/** One ad slot: after the story or in the body. Google handles the site's published CMP message. */
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
  const ad = slot.querySelector<HTMLElement>(".article-ad__unit");
  if (!ad?.dataset["adClient"] || !ad.dataset["adSlot"]) return;
  const placement = slot.dataset["placement"] === "body_slot" ? "body_slot" : "article_end";
  const measure = (name: Parameters<typeof measureReader>[0]) => measureReader(name, 1, placement);
  measure("ad_eligible");
  let statusSent = false;
  const status = new browser.MutationObserver(() => {
    const value = ad.dataset["adStatus"];
    if (statusSent || !["filled", "unfilled"].includes(value ?? "")) return;
    statusSent = true;
    measure(value === "filled" ? "ad_filled" : "ad_unfilled");
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
      measure("ad_viewable_proxy");
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
      if (placement === "body_slot") {
        const rect = slot.getBoundingClientRect();
        // Never place an inline unit in the initial viewport or next to interactive cards/images.
        const top = rect.top + browser.scrollY;
        const adjacent = [slot.previousElementSibling, slot.nextElementSibling];
        if (
          top < browser.innerHeight * 1.5 ||
          adjacent.some(
            (el) =>
              el?.matches(
                "figure, img, .gallery, .internal-link-card, .affiliate-block, .article-onward, .article-after",
              ) || el?.querySelector("img, .internal-link-card, .affiliate-block"),
          )
        )
          return;
      }
      requested = true;
      ad.classList.add("adsbygoogle");
      measure("ad_request");
      observer.disconnect();
      loadAdSense(
        doc,
        ad.dataset["adClient"]!,
        () => {
          browser.adsbygoogle ??= [];
          browser.adsbygoogle.push({});
        },
        () => measure("ad_script_error"),
      );
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

/** Both arms load the library at the same time. Each manual unit still waits until approached. */
export function mountArticleAds(
  doc: Document = document,
  browser: typeof globalThis = globalThis,
): void {
  if (!["tomokichidiary.com", "www.tomokichidiary.com"].includes(browser.location.hostname)) return;
  const slots = [...doc.querySelectorAll<HTMLElement>("[data-article-ad]")];
  const client = slots[0]?.querySelector<HTMLElement>(".article-ad__unit")?.dataset["adClient"];
  if (client && doc.documentElement.dataset["adExperiment"] === ANCHOR_AD_EXPERIMENT) {
    const load = () => loadAdSense(doc, client);
    if (doc.readyState === "complete") load();
    else browser.addEventListener("load", load, { once: true });
  }
  for (const slot of slots) mountArticleAd(slot, doc, browser);
}

const loaders = new WeakMap<
  Document,
  { status: "loading" | "loaded" | "failed"; ready: (() => void)[]; errors: (() => void)[] }
>();
function loadAdSense(doc: Document, client: string, ready?: () => void, error?: () => void): void {
  const existing = loaders.get(doc);
  if (existing) {
    if (existing.status === "loaded") ready?.();
    else if (existing.status === "failed") error?.();
    else {
      if (ready) existing.ready.push(ready);
      if (error) existing.errors.push(error);
    }
    return;
  }
  const state = {
    status: "loading" as "loading" | "loaded" | "failed",
    ready: ready ? [ready] : [],
    errors: error ? [error] : [],
  };
  loaders.set(doc, state);
  const script = doc.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  // Google's documented opt-in to a regular, dismissible bottom anchor.
  // The site's account-level Auto ads are off for the control group.
  const assignment = doc.documentElement.dataset;
  if (assignment["adExperiment"] === ANCHOR_AD_EXPERIMENT && assignment["adVariant"] === "B")
    script.dataset["overlays"] = "collapsed-bottom";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  script.addEventListener(
    "load",
    () => {
      state.status = "loaded";
      for (const fn of state.ready) fn();
      state.ready = [];
      state.errors = [];
    },
    { once: true },
  );
  script.addEventListener(
    "error",
    () => {
      state.status = "failed";
      for (const fn of state.errors) fn();
      state.ready = [];
      state.errors = [];
    },
    { once: true },
  );
  doc.head.append(script);
}
