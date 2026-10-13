import { trackSemanticEvent } from "./analytics";

export const MEASUREMENTS = [
  "article_view",
  "body_25",
  "body_50",
  "body_75",
  "body_90",
  "body_end",
  "candidate_reach",
  "visible_time",
  "next_article",
  "share_action",
  "like_action",
  "ad_eligible",
  "ad_request",
  "ad_filled",
  "ad_unfilled",
  "ad_script_error",
  "ad_viewable_proxy",
  "web_vital",
] as const;
export type Measurement = (typeof MEASUREMENTS)[number];
export function measureReader(
  measurement: Measurement,
  value = 1,
  placement = "none",
  vital = "none",
): void {
  if (
    !["tomokichidiary.com", "www.tomokichidiary.com"].includes(globalThis.location?.hostname ?? "")
  )
    return;
  trackSemanticEvent({
    name: "diary_measurement",
    measurement_version: "reader-v1",
    layout_version: "article-end-v1",
    measurement,
    value,
    placement,
    vital,
  });
}
/** No identity, text, link destinations, ad clicks or iframe inspection. */
export function mountReaderMeasurement(): void {
  const body = document.querySelector<HTMLElement>(".article-content");
  if (
    !body ||
    !["tomokichidiary.com", "www.tomokichidiary.com"].includes(globalThis.location?.hostname ?? "")
  )
    return;
  measureReader("article_view");
  const sent = new Set<string>();
  const once = (name: Measurement, placement = "none") => {
    const key = `${name}:${placement}`;
    if (sent.has(key)) return;
    sent.add(key);
    measureReader(name, 1, placement);
  };
  let frame = 0;
  const progress = () => {
    frame = 0;
    if (document.visibilityState === "hidden") return;
    const rect = body.getBoundingClientRect();
    const reached = Math.min(1, Math.max(0, (innerHeight - rect.top) / Math.max(1, rect.height)));
    for (const pct of [25, 50, 75, 90] as const) if (reached >= pct / 100) once(`body_${pct}`);
    for (const pct of [35, 65])
      if (
        rect.top + (rect.height * pct) / 100 >= 0 &&
        rect.top + (rect.height * pct) / 100 <= innerHeight
      )
        once("candidate_reach", `candidate_mid_${pct}`);
    if (rect.bottom <= innerHeight) once("body_end");
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(progress);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  addEventListener("load", schedule, { once: true });
  schedule();
  let started: number | null = document.visibilityState === "hidden" ? null : performance.now();
  let total = 0;
  const flush = () => {
    if (started === null) return;
    const elapsed = Math.min(Math.max(0, performance.now() - started), 1800000 - total);
    started = null;
    total += elapsed;
    if (elapsed > 0) measureReader("visible_time", Math.round(elapsed));
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    else {
      started ??= performance.now();
      schedule();
    }
  });
  addEventListener("pagehide", flush);
  addEventListener("pageshow", () => {
    if (document.visibilityState !== "hidden") started ??= performance.now();
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".post-navigation a, .article-related a, .story-trail a"))
      once("next_article");
    if (target?.closest(".article-share__actions button")) once("share_action");
    if (target?.closest("[data-like-button]")) once("like_action");
  });
  // The library uses buffered performance entries; no attribution/DOM data is sent.
  void import("web-vitals")
    .then(({ onCLS, onINP, onLCP }) => {
      const emit = (metric: { name: string; value: number }) => {
        if (Number.isFinite(metric.value) && metric.value >= 0)
          measureReader("web_vital", metric.value, "none", metric.name);
      };
      onCLS(emit);
      onINP(emit);
      onLCP(emit);
    })
    .catch(() => {});
}
