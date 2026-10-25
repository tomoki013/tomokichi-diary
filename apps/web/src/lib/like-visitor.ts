const storageKey = "tomokichi-like-visitor";
// Used when storage is refused (hardened or private modes): likes still work
// for this page view, they just are not remembered across visits.
let pageVisitorId: string | null = null;

/**
 * The anonymous identity behind every like on the site, articles and photos
 * alike, so one reader is one person to both. The API hashes it before storing.
 */
export function visitorId(): string {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    pageVisitorId ??= crypto.randomUUID();
    return pageVisitorId;
  }
}
