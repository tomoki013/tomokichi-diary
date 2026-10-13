import { afterEach, it, expect, vi } from "vitest";
vi.mock("../lib/analytics", () => ({ trackSemanticEvent: vi.fn() }));
vi.mock("web-vitals", () => ({ onCLS: vi.fn(), onLCP: vi.fn(), onINP: vi.fn() }));
import { trackSemanticEvent } from "../lib/analytics";
import { mountReaderMeasurement } from "../lib/readerMeasurement";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(trackSemanticEvent).mockClear();
});
const calls = () => vi.mocked(trackSemanticEvent).mock.calls.map(([e]) => e);
function fixture(host: string) {
  const callbacks = new Map<string, () => void>();
  let rect = { top: 300, height: 2000, bottom: 2300 };
  let frame: () => void = vi.fn();
  let now = 0;
  const doc = {
    visibilityState: "visible",
    querySelector: () => ({ getBoundingClientRect: () => rect }),
    addEventListener: (n: string, f: () => void) => callbacks.set(n, f),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", { hostname: host });
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => {
    frame = f;
    return 1;
  });
  vi.stubGlobal("addEventListener", (n: string, f: () => void) => callbacks.set(n, f));
  vi.stubGlobal("performance", { now: () => now });
  return {
    doc,
    callbacks,
    frame: () => frame(),
    setRect: (r: typeof rect) => {
      rect = r;
    },
    setNow: (n: number) => {
      now = n;
    },
  };
}
it.each(["localhost", "guide.tomokichidiary.com", "preview.workers.dev"])(
  "does not measure %s",
  (host) => {
    const f = fixture(host);
    mountReaderMeasurement();
    f.frame();
    expect(trackSemanticEvent).not.toHaveBeenCalled();
  },
);
it("counts actual candidate exposure once and excludes background time without collecting text or identity", () => {
  const f = fixture("tomokichidiary.com");
  mountReaderMeasurement();
  f.frame();
  f.setRect({ top: -1000, height: 2000, bottom: 1000 });
  f.callbacks.get("scroll")!();
  f.frame();
  f.callbacks.get("scroll")!();
  f.frame();

  expect(
    calls().filter((e) => e.name === "diary_measurement" && e.measurement === "candidate_reach"),
  ).toHaveLength(1);
  f.setNow(1000);
  f.doc.visibilityState = "hidden";
  f.callbacks.get("visibilitychange")!();
  f.setNow(100000);
  f.doc.visibilityState = "visible";
  f.callbacks.get("visibilitychange")!();
  f.setNow(101000);
  f.callbacks.get("pagehide")!();
  f.callbacks.get("pagehide")!();
  expect(
    calls()
      .filter((e) => e.name === "diary_measurement" && e.measurement === "visible_time")
      .map((e) => (e.name === "diary_measurement" ? e.value : 0)),
  ).toEqual([1000, 1000]);
  expect(Object.keys(calls()[0]!)).toEqual([
    "name",
    "measurement_version",
    "layout_version",
    "measurement",
    "value",
    "placement",
    "vital",
  ]);
});
