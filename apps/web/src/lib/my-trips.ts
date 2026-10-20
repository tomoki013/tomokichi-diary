/**
 * The reader's own shelf: stories they liked and stories they shared, kept in
 * this browser only. Likes are counted on the server per anonymous visitor,
 * but the server has no "list what I liked" call and does not need one — the
 * shelf is a convenience, so losing it (private mode, cleared storage) costs
 * nothing but the list. The shelf itself is never sent anywhere.
 *
 * Browser-only: imported from component `<script>`s, never from frontmatter.
 */
export type ShelfKind = "liked" | "shared";

export interface ShelfEntry {
  readonly path: string;
  readonly title: string;
  /** When the story was first put on the shelf. */
  readonly at: string;
}

const KEY = "tomokichi-my-trips";
/*
 * One entry per path, so a shelf can never hold more than the site has
 * stories. This used to be 50, which silently pushed the oldest likes out;
 * the cap is now only a guard against a corrupted store.
 */
const LIMIT = 1000;
/** Fired on `window` after this tab changes the shelf; other tabs get `storage`. */
const CHANGE_EVENT = "tomokichi:my-trips-change";

type Shelves = Record<ShelfKind, ShelfEntry[]>;

const isEntry = (value: unknown): value is ShelfEntry => {
  const entry = value as Partial<ShelfEntry> | null;
  return (
    typeof entry?.path === "string" &&
    entry.path.startsWith("/") &&
    typeof entry.title === "string" &&
    typeof entry.at === "string"
  );
};

function read(): Shelves {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Shelves> | null;
    return {
      liked: Array.isArray(parsed?.liked) ? parsed.liked.filter(isEntry) : [],
      shared: Array.isArray(parsed?.shared) ? parsed.shared.filter(isEntry) : [],
    };
  } catch {
    return { liked: [], shared: [] };
  }
}

function write(shelves: Shelves): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(shelves));
  } catch {
    // Storage refused (private mode, quota): the shelf simply is not kept.
    return;
  }
  syncLikedFlag();
  dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * Mirrors "this browser has likes" onto `<html data-has-liked>`. The layout's
 * head script sets it before first paint, so the space for the liked list and
 * the shortcuts to it is there from the start; this keeps it current.
 */
export function syncLikedFlag(): void {
  document.documentElement.toggleAttribute("data-has-liked", read().liked.length > 0);
}

export function shelf(kind: ShelfKind): readonly ShelfEntry[] {
  return read()[kind];
}

/**
 * Newest first, one entry per path. A story already on the shelf keeps its
 * place and its date: a like button re-reading its state on every page view
 * used to move the story to the top and reset when it was liked.
 */
export function remember(kind: ShelfKind, path: string, title: string): void {
  if (!path || !title) return;
  const current = read();
  const existing = current[kind].find((entry) => entry.path === path);
  if (existing) {
    if (existing.title === title) return;
    current[kind] = current[kind].map((entry) =>
      entry.path === path ? { ...entry, title } : entry,
    );
  } else {
    current[kind] = [{ path, title, at: new Date().toISOString() }, ...current[kind]].slice(
      0,
      LIMIT,
    );
  }
  write(current);
}

export function forget(kind: ShelfKind, path: string): void {
  const current = read();
  if (!current[kind].some((entry) => entry.path === path)) return;
  current[kind] = current[kind].filter((entry) => entry.path !== path);
  write(current);
}

/** Calls back when the shelf changes in this tab or in another one. */
export function onShelfChange(callback: () => void): void {
  addEventListener(CHANGE_EVENT, callback);
  addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) callback();
  });
}
