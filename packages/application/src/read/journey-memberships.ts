import type { ArticleCollection, ArticleId, CollectionId } from "@tomokichi/domain";

export function membershipsByArticle(rows: readonly ArticleCollection[]) {
  const grouped = new Map<ArticleId, ArticleCollection[]>();
  for (const row of rows) {
    const list = grouped.get(row.articleId);
    if (list) list.push(row);
    else grouped.set(row.articleId, [row]);
  }
  return grouped;
}

/** Keep series and existing journey order, then resolve the revision's journey IDs. */
export function resolveJourneyMemberships(
  memberships: readonly ArticleCollection[],
  articleId: ArticleId,
  journeyIds: readonly CollectionId[] | undefined,
  knownJourneys: ReadonlySet<CollectionId>,
): readonly ArticleCollection[] {
  if (journeyIds === undefined) return memberships;
  const selected = new Set(journeyIds.filter((id) => knownJourneys.has(id)));
  return [
    ...memberships.filter(
      (row) => !knownJourneys.has(row.collectionId) || selected.delete(row.collectionId),
    ),
    ...[...selected].map((collectionId) => ({ articleId, collectionId, sortOrder: 0 })),
  ];
}
