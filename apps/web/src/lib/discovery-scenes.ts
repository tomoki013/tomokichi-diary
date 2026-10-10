/**
 * Browser side of the home discovery scenes. Each scene component registers
 * what should happen when its panel comes on stage. Listeners go on the
 * `signal` it is given, and it may hand back a function for anything else to
 * stop (timers, animation loops); both are torn down when the reader moves
 * on. Panels are cached and come back, so entering twice must be safe.
 * `AdaptiveDiscovery` calls `enterScene` whenever a panel is shown.
 *
 * A scene only starts once its panel is actually on screen: on a phone the
 * panel usually begins below the fold, and an entrance that plays while
 * nobody is looking is wasted.
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
  leave?.();
  leave = undefined;
  const enter = scenes.get(panel.dataset.template ?? "");
  if (!enter) return;
  const controller = new AbortController();
  let stop: Leave | void;
  const start = () => {
    if (!controller.signal.aborted) stop = enter(panel, !reducedMotion(), controller.signal);
  };
  let watcher: IntersectionObserver | null = null;
  if ("IntersectionObserver" in globalThis) {
    watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher?.disconnect();
        start();
      },
      { threshold: 0.15 },
    );
    watcher.observe(panel);
  } else {
    start();
  }
  leave = () => {
    watcher?.disconnect();
    controller.abort();
    stop?.();
  };
}

export function registerScene(id: string, enter: Enter): void {
  scenes.set(id, enter);
  if (current?.dataset.template === id) run(current);
}

export function enterScene(panel: HTMLElement): void {
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

/**
 * Calls `onChange` as each element enters or leaves the middle band of the
 * screen — the place a reader's eyes are while scrolling with a thumb. This
 * is what replaces hover on a phone.
 */
export function watchCentre(
  elements: readonly Element[],
  onChange: (element: Element, centred: boolean) => void,
  signal: AbortSignal,
): void {
  if (!("IntersectionObserver" in globalThis)) return;
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => onChange(entry.target, entry.isIntersecting)),
    { rootMargin: "-40% 0px -40% 0px" },
  );
  elements.forEach((element) => observer.observe(element));
  signal.addEventListener("abort", () => observer.disconnect());
}
