/*
 * Which articles this browser has read to the end, kept only on the device
 * (localStorage). Cards for those articles say so, and the "next" card at the
 * end of an article skips them. Nothing here is sent anywhere.
 */
const KEY = "tomokichi-read-v1";
const LIMIT = 300;

const normalise = (path: string) => path.replace(/\/+$/, "") || "/";

export function readPaths(): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((p) => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

export function markRead(path: string): void {
  try {
    const paths = [...readPaths()].filter((p) => p !== normalise(path));
    paths.push(normalise(path));
    localStorage.setItem(KEY, JSON.stringify(paths.slice(-LIMIT)));
  } catch {
    // Private modes may refuse storage; the marks are a convenience only.
  }
}

/** Article cards whose link points at a read article get `data-read`. */
export function decorateReadLinks(root: ParentNode = document): void {
  const paths = readPaths();
  if (paths.size === 0) return;
  const here = normalise(location.pathname);
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="/posts/"]')) {
    const path = normalise(new URL(link.href).pathname);
    if (path === here || !paths.has(path)) continue;
    link
      .closest(".card, .internal-link-card, .story-rail li, .post-navigation__card")
      ?.setAttribute("data-read", "");
  }
}

/** Shows the first next-read candidate this browser has not read yet. */
export function chooseNextRead(root: ParentNode = document): void {
  const list = root.querySelector<HTMLElement>("[data-next-read]");
  if (!list) return;
  const items = [...list.querySelectorAll<HTMLElement>("[data-next-path]")];
  const paths = readPaths();
  const pick = items.find((item) => !paths.has(item.dataset["nextPath"] ?? "")) ?? items[0];
  for (const item of items) item.hidden = item !== pick;
}
