import { describe, expect, it, vi } from "vitest";
import { ANCHOR_AD_EXPERIMENT } from "@tomokichi/contracts";
import { mountArticleAds } from "../lib/ads";

function page(variant?: "A" | "B", hostname = "tomokichidiary.com") {
  const unit = {
    dataset: { adClient: "ca-pub-example", adSlot: "123" },
    classList: { add: vi.fn() },
  };
  const slot = {
    dataset: { placement: "article_end" },
    querySelector: (selector: string) => (selector === ".article-ad__unit" ? unit : null),
    getBoundingClientRect: () => ({ width: 400 }),
  };
  const script = Object.assign(new EventTarget(), { dataset: {} as Record<string, string> });
  const append = vi.fn();
  let approach: (() => void) | undefined;
  const browser = {
    location: { hostname },
    adsbygoogle: [],
    addEventListener: vi.fn(),
    MutationObserver: class {
      observe() {}
    },
    IntersectionObserver: class {
      constructor(
        callback: (entries: { isIntersecting: boolean }[]) => void,
        options: IntersectionObserverInit,
      ) {
        if (options.rootMargin) approach = () => callback([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    },
  };
  const doc = {
    readyState: "complete",
    visibilityState: "visible",
    documentElement: {
      dataset: variant ? { adExperiment: ANCHOR_AD_EXPERIMENT, adVariant: variant } : {},
    },
    addEventListener: vi.fn(),
    querySelectorAll: () => [slot],
    createElement: () => script,
    head: { append },
  };
  const mount = () =>
    mountArticleAds(doc as unknown as Document, browser as unknown as typeof globalThis);
  return { mount, append, script, browser, approach: () => approach?.() };
}

describe("anchor ad delivery", () => {
  it.each(["A", "B"] as const)(
    "preloads one script in %s and requests the shared unit only when reached",
    (arm) => {
      const p = page(arm);
      p.mount();
      p.mount();
      expect(p.append).toHaveBeenCalledTimes(1);
      expect(p.script.dataset["overlays"]).toBe(arm === "B" ? "collapsed-bottom" : undefined);
      p.script.dispatchEvent(new Event("load"));
      expect(p.browser.adsbygoogle).toEqual([]);
      p.approach();
      p.approach();
      expect(p.browser.adsbygoogle).toEqual([{}]);
      expect(p.append).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps normal delivery lazy when stopped and never loads on previews", () => {
    const stopped = page();
    stopped.mount();
    expect(stopped.append).not.toHaveBeenCalled();
    stopped.approach();
    expect(stopped.append).toHaveBeenCalledTimes(1);
    expect(stopped.script.dataset["overlays"]).toBeUndefined();
    const preview = page("B", "localhost");
    preview.mount();
    preview.approach();
    expect(preview.append).not.toHaveBeenCalled();
  });
});
