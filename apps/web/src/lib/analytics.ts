import type { SemanticEvent } from "@tomokichi/application";

declare global {
  // `var` so the declarations reach `globalThis`, which is what the call
  // below reads; an `interface Window` member alone does not.
  var dataLayer: unknown[] | undefined;
  var gtag: ((...args: unknown[]) => void) | undefined;
}

/**
 * One semantic browser boundary; the analytics vendor plugs in here, not in
 * components. GA4 (`gtag`) is defined on production and on the explicitly
 * configured DebugView host. Other builds only dispatch the DOM event.
 */
export function trackSemanticEvent(event: SemanticEvent): void {
  globalThis.dispatchEvent(new CustomEvent("tomokichi:analytics", { detail: event }));
  const { name, ...params } = event;
  globalThis.gtag?.("event", name, params);
}
