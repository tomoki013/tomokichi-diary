import type { Location, LocationName } from "../entities/location.js";
import type { LocationId } from "../primitives/id.js";
import type { Locale } from "../primitives/locale.js";

/** Read model over the flat Location table: ancestry, descendants and display names. */
export class LocationTree {
  private readonly byId = new Map<LocationId, Location>();
  private readonly childrenOf = new Map<LocationId | null, Location[]>();
  private readonly names = new Map<string, LocationName>();

  constructor(locations: readonly Location[], names: readonly LocationName[] = []) {
    for (const location of locations) {
      this.byId.set(location.id, location);
      const siblings = this.childrenOf.get(location.parentId) ?? [];
      siblings.push(location);
      this.childrenOf.set(location.parentId, siblings);
    }
    for (const name of names) this.names.set(`${name.locationId}:${name.locale}`, name);
  }

  get(id: LocationId): Location | undefined {
    return this.byId.get(id);
  }

  roots(): readonly Location[] {
    return this.childrenOf.get(null) ?? [];
  }

  children(id: LocationId): readonly Location[] {
    return this.childrenOf.get(id) ?? [];
  }

  /** Root-first, excluding the location itself — the shape a breadcrumb needs. */
  ancestors(id: LocationId): readonly Location[] {
    const chain: Location[] = [];
    const seen = new Set<LocationId>([id]);
    let current = this.byId.get(id)?.parentId ?? null;
    while (current !== null && !seen.has(current)) {
      const parent = this.byId.get(current);
      if (!parent) break;
      chain.push(parent);
      seen.add(parent.id);
      current = parent.parentId;
    }
    return chain.toReversed();
  }

  descendants(id: LocationId): readonly Location[] {
    const out: Location[] = [];
    const queue = [...this.children(id)];
    while (queue.length > 0) {
      const next = queue.shift()!;
      out.push(next);
      queue.push(...this.children(next.id));
    }
    return out;
  }

  descendantIds(id: LocationId): readonly LocationId[] {
    return this.descendants(id).map((l) => l.id);
  }

  /** Falls back to the slug so a missing translation never renders an empty label. */
  nameOf(id: LocationId, locale: Locale): string {
    return this.names.get(`${id}:${locale}`)?.name ?? this.byId.get(id)?.slug ?? String(id);
  }

  countryOf(id: LocationId): Location | undefined {
    const self = this.byId.get(id);
    if (self?.type === "country") return self;
    return this.ancestors(id).findLast((l) => l.type === "country");
  }
}
