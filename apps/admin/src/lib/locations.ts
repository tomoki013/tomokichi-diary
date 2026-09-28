import type { LocationDto } from "@tomokichi/contracts";

const collator = new Intl.Collator("ja");

/**
 * Locations arrive as a flat list; a picker reads better as a tree. Parents
 * come before their children, siblings in Japanese reading order, and a
 * location whose parent is missing is treated as a root rather than dropped.
 */
export function treeOrder(
  locations: readonly LocationDto[],
): { location: LocationDto; depth: number }[] {
  const ids = new Set(locations.map((location) => location.id));
  const children = new Map<string | null, LocationDto[]>();
  for (const location of locations) {
    const parent = location.parentId && ids.has(location.parentId) ? location.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), location]);
  }

  const out: { location: LocationDto; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number): void => {
    const siblings = (children.get(parent) ?? []).toSorted((a, b) =>
      collator.compare(a.name, b.name),
    );
    for (const location of siblings) {
      // A cycle in bad data must not hang the editor.
      if (seen.has(location.id)) continue;
      seen.add(location.id);
      out.push({ location, depth });
      visit(location.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
