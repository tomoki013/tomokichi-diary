import type { SemanticEvent } from "@tomokichi/application";

declare global {
  // `var` so the declaration reaches `globalThis`, which is what the call
  // below reads; an `interface Window` member alone does not.
  var dataLayer: unknown[] | undefined;
}

/** One semantic browser boundary; a future analytics vendor plugs in here, not in components. */
export function trackSemanticEvent(event: SemanticEvent): void {
  globalThis.dispatchEvent(new CustomEvent("tomokichi:analytics", { detail: event }));
  globalThis.dataLayer?.push({ event: event.name, ...event });
}
