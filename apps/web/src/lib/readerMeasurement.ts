import { isAdExperimentId } from "@tomokichi/contracts";
import { trackSemanticEvent } from "./analytics";

export const MEASUREMENTS = [
  "article_view",
  "experiment_assignment",
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
  const context = measurementContext();
  trackSemanticEvent({
    name: "diary_measurement",
    measurement_version: "reader-v1",
    ...context,
    measurement,
    value,
    placement,
    vital,
  });
}
/*
 * A click to another article used to be sent as the page unloaded, and phones
 * dropped almost all of them (about 30 recorded against 680 article-to-article
 * page views in October 2026). The click now leaves a note in this tab, and
 * the next article sends it with the first page's address and test arm.
 */
const PENDING_NEXT = "tomokichi-next-article";
function deferNextArticle(): void {
  try {
    sessionStorage.setItem(
      PENDING_NEXT,
      JSON.stringify({ at: Date.now(), from: location.href, context: measurementContext() }),
    );
  } catch {
    measureReader("next_article");
  }
}
function sendPendingNextArticle(): void {
  let note: { at?: number; from?: string; context?: ReturnType<typeof measurementContext> };
  try {
    note = JSON.parse(sessionStorage.getItem(PENDING_NEXT) ?? "null") ?? {};
    sessionStorage.removeItem(PENDING_NEXT);
  } catch {
    return;
  }
  if (!note.context || !note.from || Date.now() - (note.at ?? 0) > 120_000) return;
  trackSemanticEvent({
    name: "diary_measurement",
    measurement_version: "reader-v1",
    ...note.context,
    measurement: "next_article",
    value: 1,
    placement: "none",
    vital: "none",
    page_location: note.from,
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
  if (mounted.has(document)) return;
  mounted.add(document);
  sendPendingNextArticle();
  measureReader("article_view");
  if (
    measurementContext().experiment_id !== "none" &&
    isAdExperimentId(measurementContext().experiment_id)
  )
    measureReader("experiment_assignment");
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
    const next = target?.closest<HTMLAnchorElement>(
      ".post-navigation a, .article-related .card > a, .article-related .card__title a, .story-trail .story-rail__title, .story-trail .story-rail__thumb, .internal-link-card a",
    );
    if (next && !sent.has("next_article:none")) {
      const to = new URL(next.href, location.href);
      // Only an article runs this script to send the note; other pages get the old path.
      if (to.origin === location.origin && to.pathname.startsWith("/posts/")) {
        sent.add("next_article:none");
        deferNextArticle();
      } else once("next_article");
    }
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

const mounted = new WeakSet<Document>();
function measurementContext(): {
  layout_version: "article-end-v1" | "article-placement-v2";
  experiment_id?: string;
  variant_id?: "A" | "B" | "none";
  placement_key?: string;
} {
  const article = globalThis.document?.querySelector<HTMLElement>(".article-page");
  if (article?.dataset?.["adLayout"] !== "article-placement-v2")
    return { layout_version: "article-end-v1" };
  const root = document.documentElement?.dataset;
  const experimentId = root?.["adExperiment"];
  const experiment = isAdExperimentId(experimentId);
  const variant = root?.["adVariant"];
  return {
    layout_version: "article-placement-v2",
    experiment_id: experiment ? experimentId : "none",
    variant_id: experiment && (variant === "A" || variant === "B") ? variant : "none",
    placement_key:
      experiment && variant === "A"
        ? "article-end"
        : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.dataset["adKey"] ?? "") &&
            (article.dataset["adKey"]?.length ?? 0) <= 64
          ? article.dataset["adKey"]!
          : "none",
  };
}
