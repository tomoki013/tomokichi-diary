/**
 * Browser side of the home discovery scenes. Each scene component registers
 * what should happen when its panel comes on stage. Listeners go on the
 * `signal` it is given, and it may hand back a function for anything else to
 * stop (timers, animation loops); both are torn down when the reader moves
 * on. Panels are cached and come back, so entering twice must be safe.
 * `AdaptiveDiscovery` calls `enterScene` whenever a panel is shown.
 *
 * Registration and entry can happen in either order — the scene scripts are
 * separate modules — so a scene that registers late still starts if its
 * panel is already showing.
 */

type Leave = () => void;
type Enter = (panel: HTMLElement, motion: boolean, signal: AbortSignal) => Leave | void;

const scenes = new Map<string, Enter>();
let current: HTMLElement | null = null;
let leave: Leave | undefined;

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function run(panel: HTMLElement) {
  const enter = scenes.get(panel.dataset.template ?? "");
  if (!enter) return;
  const controller = new AbortController();
  const stop = enter(panel, !reducedMotion(), controller.signal);
  leave = () => {
    controller.abort();
    stop?.();
  };
}

export function registerScene(id: string, enter: Enter): void {
  scenes.set(id, enter);
  if (current?.dataset.template === id) run(current);
}

export function enterScene(panel: HTMLElement): void {
  leave?.();
  leave = undefined;
  current = panel;
  run(panel);
}

/** Restart a CSS animation on `element` by toggling `className` across a frame. */
export function replay(element: Element, className: string): void {
  element.classList.remove(className);
  // Reading layout here is what makes the browser forget the old run.
  void (element as HTMLElement).offsetWidth;
  element.classList.add(className);
}
