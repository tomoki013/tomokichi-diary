import type { SemanticEvent } from "@tomokichi/application";

declare global {
  // `var` so the declarations reach `globalThis`, which is what the call
  // below reads; an `interface Window` member alone does not.
  var dataLayer: unknown[] | undefined;
  var gtag: ((...args: unknown[]) => void) | undefined;
}

/**
 * One semantic browser boundary; the analytics vendor plugs in here, not in
 * components. GA4 (`gtag`) is only defined on the production hostname (see
 * `BaseLayout.astro`), so previews and local builds dispatch the DOM event and
 * nothing else.
 */
export function trackSemanticEvent(event: SemanticEvent): void {
  globalThis.dispatchEvent(new CustomEvent("tomokichi:analytics", { detail: event }));
  const { name, ...params } = event;
  globalThis.gtag?.("event", name, params);
}
