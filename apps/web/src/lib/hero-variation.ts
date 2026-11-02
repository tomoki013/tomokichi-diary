/** Stable page-specific art direction: the same route always renders the same hero. */
export function heroVariantOf(path: string): number {
  const artDirection: Record<string, number> = {
    "/destination/china/shanghai": 4,
    "/destination/egypt/cairo": 5,
    "/destination/greece/santorini": 3,
    "/destination/greece": 1,
    "/destination/india": 2,
    "/collections/architecture": 1,
    "/collections/landscape": 3,
    "/collections/sunset": 4,
    "/collections/kyoto": 5,
    "/collections/travel-diary": 2,
    "/collections/travel-history": 0,
    "/collections/hokkaido-2024-02": 5,
    "/collections/bangkok-2024-03": 0,
    "/collections/bangkok-to-santorini-2025-06": 3,
    "/collections/new-delhi-2024-09": 2,
    "/collections/paris-2025-02": 4,
    "/collections/shanghai-2025-11": 2,
    "/collections/kuala-lumpur-2026-03": 0,
  };
  if (path in artDirection) return artDirection[path]!;
  let hash = 2166136261;
  for (const character of path) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 6;
}
