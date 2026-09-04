import type { SemanticEvent } from "@tomokichi/application";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** One semantic browser boundary; a future analytics vendor plugs in here, not in components. */
export function trackSemanticEvent(event: SemanticEvent): void {
  globalThis.dispatchEvent(new CustomEvent("tomokichi:analytics", { detail: event }));
  globalThis.dataLayer?.push({ event: event.name, ...event });
}
