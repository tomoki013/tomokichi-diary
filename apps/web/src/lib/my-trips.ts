/**
 * The reader's own shelf: stories they liked and stories they shared, kept in
 * this browser only. Likes are counted on the server per anonymous visitor,
 * but the server has no "list what I liked" call and does not need one — the
 * shelf is a convenience, so losing it (private mode, cleared storage) costs
 * nothing but the list.
 *
 * Browser-only: imported from component `<script>`s, never from frontmatter.
 */
export type ShelfKind = "liked" | "shared";

export interface ShelfEntry {
  readonly path: string;
  readonly title: string;
  readonly at: string;
}

const KEY = "tomokichi-my-trips";
const LIMIT = 50;

type Shelves = Record<ShelfKind, ShelfEntry[]>;

function read(): Shelves {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Shelves> | null;
    return {
      liked: Array.isArray(parsed?.liked) ? parsed.liked : [],
      shared: Array.isArray(parsed?.shared) ? parsed.shared : [],
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
  }
}

export function shelf(kind: ShelfKind): readonly ShelfEntry[] {
  return read()[kind];
}

/** Newest first, one entry per path. */
export function remember(kind: ShelfKind, path: string, title: string): void {
  if (!path || !title) return;
  const current = read();
  current[kind] = [
    { path, title, at: new Date().toISOString() },
    ...current[kind].filter((entry) => entry.path !== path),
  ].slice(0, LIMIT);
  write(current);
}

export function forget(kind: ShelfKind, path: string): void {
  const current = read();
  current[kind] = current[kind].filter((entry) => entry.path !== path);
  write(current);
}
