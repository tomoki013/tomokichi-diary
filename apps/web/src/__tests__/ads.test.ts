import { describe, expect, it, vi } from "vitest";
import { mountArticleAd } from "../lib/ads";

function fixture(host = "tomokichidiary.com", width = 600, readyState = "complete") {
  const scriptEvents = new Map<string, () => void>();
  const pageEvents = new Map<string, () => void>();
  const ad = { dataset: { adClient: "ca-pub-8687520805381056", adSlot: "7152502134" } };
  const script = { addEventListener: (name: string, fn: () => void) => scriptEvents.set(name, fn) };
  const append = vi.fn();
  const observe = vi.fn();
  const disconnect = vi.fn();
  let intersect: (entries: { isIntersecting: boolean }[]) => void = vi.fn();
  const slot = {
    dataset: {} as Record<string, string>,
    querySelector: (selector: string) => (selector === ".adsbygoogle" ? ad : null),
    getBoundingClientRect: () => ({ width }),
  } as unknown as HTMLElement;
  const doc = {
    readyState,
    visibilityState: "visible",
    createElement: () => script,
    head: { append },
  } as unknown as Document;
  const browser = {
    location: { hostname: host },
    IntersectionObserver: class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
    addEventListener: (name: string, fn: () => void) => pageEvents.set(name, fn),
  } as unknown as typeof globalThis;
  return {
    slot,
    doc,
    browser,
    append,
    observe,
    disconnect,
    scriptEvents,
    pageEvents,
    intersect: (visible: boolean) => intersect([{ isIntersecting: visible }]),
  };
}

describe("article ad requests", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "tomokichi-diary-web.workers.dev",
    "guide.tomokichidiary.com",
  ])("never requests ads on %s", (host) => {
    const f = fixture(host);
    mountArticleAd(f.slot, f.doc, f.browser);
    f.intersect(true);
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.append).not.toHaveBeenCalled();
  });
  it("waits for page load and proximity, then requests only once", () => {
    const f = fixture("tomokichidiary.com", 600, "loading");
    mountArticleAd(f.slot, f.doc, f.browser);
    mountArticleAd(f.slot, f.doc, f.browser);
    expect(f.observe).not.toHaveBeenCalled();
    f.pageEvents.get("load")!();
    expect(f.observe).toHaveBeenCalledOnce();
    f.intersect(false);
    expect(f.append).not.toHaveBeenCalled();
    f.intersect(true);
    f.intersect(true);
    expect(f.append).toHaveBeenCalledOnce();
    expect(f.disconnect).toHaveBeenCalledOnce();
    expect(f.browser.adsbygoogle).toBeUndefined();
    f.scriptEvents.get("load")!();
    expect(f.browser.adsbygoogle).toEqual([{}]);
  });
  it("does not request a fixed ad when it cannot fit", () => {
    const f = fixture("tomokichidiary.com", 290);
    mountArticleAd(f.slot, f.doc, f.browser);
    f.intersect(true);
    expect(f.append).not.toHaveBeenCalled();
  });
  it("does not enqueue or retry a blocked script", () => {
    const f = fixture();
    mountArticleAd(f.slot, f.doc, f.browser);
    f.intersect(true);
    f.intersect(true);
    expect(f.append).toHaveBeenCalledOnce();
    expect(f.browser.adsbygoogle).toBeUndefined();
    expect(f.scriptEvents.has("error")).toBe(false);
  });
});
