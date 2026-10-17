import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/readerMeasurement", () => ({ measureReader: vi.fn() }));
import { measureReader } from "../lib/readerMeasurement";
import { mountArticleAd } from "../lib/ads";

function fixture(host = "tomokichidiary.com", width = 600, readyState = "complete") {
  const scriptEvents = new Map<string, () => void>();
  const pageEvents = new Map<string, () => void>();
  const ad = {
    dataset: { adClient: "ca-pub-8687520805381056", adSlot: "7152502134", adStatus: "" },
  };
  const script = { addEventListener: (name: string, fn: () => void) => scriptEvents.set(name, fn) };
  const append = vi.fn();
  const observe = vi.fn();
  const disconnect = vi.fn();
  let viewIntersect: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void =
    vi.fn();
  let mutation: () => void = vi.fn();
  let intersect: (entries: { isIntersecting: boolean }[]) => void = vi.fn();
  const slot = {
    dataset: {} as Record<string, string>,
    querySelector: (selector: string) => (selector === ".adsbygoogle" ? ad : null),
    getBoundingClientRect: () => ({ width }),
  } as unknown as HTMLElement;
  const doc = {
    addEventListener: (name: string, fn: () => void) => pageEvents.set(name, fn),
    readyState,
    visibilityState: "visible",
    createElement: () => script,
    head: { append },
  } as unknown as Document;
  const browser = {
    location: { hostname: host },
    setTimeout,
    clearTimeout,
    MutationObserver: class {
      constructor(callback: () => void) {
        mutation = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
    IntersectionObserver: class {
      constructor(callback: typeof intersect, options: { threshold: number | number[] }) {
        if (Array.isArray(options.threshold)) viewIntersect = callback as typeof viewIntersect;
        else intersect = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
    addEventListener: (name: string, fn: () => void) => pageEvents.set(name, fn),
  } as unknown as typeof globalThis;
  return {
    slot,
    ad,
    mutation: () => mutation(),
    viewIntersect: (visible: boolean) =>
      viewIntersect([{ isIntersecting: visible, intersectionRatio: visible ? 0.6 : 0 }]),
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
    expect(f.observe).toHaveBeenCalledOnce();
    f.pageEvents.get("load")!();
    expect(f.observe).toHaveBeenCalledTimes(2);
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
    expect(f.scriptEvents.has("error")).toBe(true);
    f.scriptEvents.get("error")!();
    expect(measureReader).toHaveBeenCalledWith("ad_script_error", 1, "article_end");
  });
});

it("counts proxy visibility only after fill and a continuous visible second", () => {
  vi.useFakeTimers();
  vi.mocked(measureReader).mockClear();
  const f = fixture();
  mountArticleAd(f.slot, f.doc, f.browser);
  f.viewIntersect(true);
  vi.advanceTimersByTime(1200);
  expect(measureReader).not.toHaveBeenCalledWith("ad_viewable_proxy", 1, "article_end");
  f.ad.dataset.adStatus = "filled";
  f.mutation();
  vi.advanceTimersByTime(600);
  f.viewIntersect(false);
  vi.advanceTimersByTime(1200);
  expect(measureReader).not.toHaveBeenCalledWith("ad_viewable_proxy", 1, "article_end");
  f.viewIntersect(true);
  vi.advanceTimersByTime(1000);
  f.viewIntersect(true);
  vi.advanceTimersByTime(1000);
  expect(
    vi.mocked(measureReader).mock.calls.filter(([name]) => name === "ad_viewable_proxy"),
  ).toHaveLength(1);
  vi.useRealTimers();
});

it("shares one loader across mounts and enqueues each unit only once", () => {
  const f = fixture();
  const second = {
    ...f.slot,
    dataset: {},
    querySelector: f.slot.querySelector,
    getBoundingClientRect: f.slot.getBoundingClientRect,
  } as HTMLElement;
  mountArticleAd(f.slot, f.doc, f.browser);
  f.intersect(true);
  f.scriptEvents.get("load")!();
  mountArticleAd(second, f.doc, f.browser);
  f.intersect(true);
  f.intersect(true);
  expect(f.append).toHaveBeenCalledOnce();
  expect(f.browser.adsbygoogle).toHaveLength(2);
});
it("mounts only the selected variant before sending eligibility, including blocked ads", async () => {
  vi.mocked(measureReader).mockClear();
  const { mountArticleAds } = await import("../lib/ads");
  const f = fixture();
  f.slot.dataset["variant"] = "B";
  const rejected = {
    dataset: { variant: "A" },
    querySelector: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLElement;
  Object.assign(f.doc, {
    documentElement: { dataset: { adVariant: "B" } },
    querySelectorAll: () => [rejected, f.slot],
  });
  mountArticleAds(f.doc, f.browser);
  mountArticleAds(f.doc, f.browser);
  expect(rejected.querySelector).not.toHaveBeenCalled();
  expect(vi.mocked(measureReader).mock.calls.filter(([m]) => m === "ad_eligible")).toHaveLength(1);
});
