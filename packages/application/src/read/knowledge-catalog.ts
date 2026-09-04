import type { ContentSnapshot } from "@tomokichi/data";
import type { ArticleId, Provenance, TravelFactKind } from "@tomokichi/domain";

export interface KnowledgeCatalogEntry {
  readonly articleId: string;
  readonly title: string;
  readonly summary: string;
  readonly path: string;
  readonly quickAnswer: string | null;
  readonly facts: readonly {
    readonly id: string;
    readonly kind: TravelFactKind;
    readonly statement: string;
    readonly provenance: Provenance;
    readonly experiencedAt: string | null;
    readonly verifiedAt: string | null;
    readonly sourceIds: readonly string[];
  }[];
  readonly sources: readonly {
    readonly id: string;
    readonly type: string;
    readonly name: string;
    readonly url: string | null;
    readonly checkedAt: string | null;
  }[];
  readonly routes: readonly { readonly id: string; readonly name: string; readonly mode: string }[];
}

/** Compact, protocol-neutral read model shared by WebMCP and the public MCP Worker. */
export function buildKnowledgeCatalog(snapshot: ContentSnapshot): readonly KnowledgeCatalogEntry[] {
  return snapshot.articleKnowledge.flatMap((knowledge) => {
    const article = snapshot.articles.find(
      (item) =>
        item.id === knowledge.articleId && item.publishedRevisionId === knowledge.revisionId,
    );
    const revision = snapshot.revisions.find((item) => item.id === knowledge.revisionId);
    const route = snapshot.routes.find(
      (item) =>
        item.targetType === "article" && item.targetId === knowledge.articleId && item.isCanonical,
    );
    if (!article || !revision || !route || article.status !== "published") return [];
    const factIds = new Set([
      ...knowledge.experienceGroups.flatMap((group) => group.factIds),
      ...knowledge.currentFactIds,
      ...knowledge.cautionFactIds,
    ]);
    return [
      {
        articleId: article.id,
        title: revision.title,
        summary: revision.summary,
        path: route.path,
        quickAnswer: knowledge.quickAnswer?.summary ?? null,
        facts: snapshot.travelFacts
          .filter((fact) => factIds.has(fact.id) && fact.status === "verified")
          .map(({ id, kind, statement, provenance, experiencedAt, verifiedAt, sourceIds }) => ({
            id,
            kind,
            statement,
            provenance,
            experiencedAt,
            verifiedAt,
            sourceIds,
          })),
        sources: snapshot.sources.filter((source) =>
          snapshot.travelFacts
            .filter((fact) => factIds.has(fact.id) && fact.status === "verified")
            .some((fact) => fact.sourceIds.includes(source.id)),
        ),
        routes: knowledge.routeIds.flatMap((id) => {
          const travelRoute = snapshot.travelRoutes.find((item) => item.id === id);
          return travelRoute ? [{ id, name: travelRoute.name, mode: travelRoute.mode }] : [];
        }),
      },
    ];
  });
}

export function searchKnowledgeCatalog(
  catalog: readonly KnowledgeCatalogEntry[],
  input: {
    readonly query?: string;
    readonly provenance?: Provenance;
    readonly kind?: TravelFactKind;
  },
): readonly KnowledgeCatalogEntry[] {
  const needle = input.query?.trim().toLocaleLowerCase("ja") ?? "";
  return catalog.flatMap((entry) => {
    const facts = entry.facts.filter(
      (fact) =>
        (input.provenance === undefined || fact.provenance === input.provenance) &&
        (input.kind === undefined || fact.kind === input.kind),
    );
    if ((input.provenance !== undefined || input.kind !== undefined) && facts.length === 0)
      return [];
    const matches =
      needle === "" ||
      [entry.title, entry.summary, entry.quickAnswer ?? "", ...facts.map((fact) => fact.statement)]
        .join("\n")
        .toLocaleLowerCase("ja")
        .includes(needle);
    return matches ? [{ ...entry, facts }] : [];
  });
}

export function getArticleKnowledgeFromCatalog(
  catalog: readonly KnowledgeCatalogEntry[],
  articleId: ArticleId | string,
) {
  return catalog.find((entry) => entry.articleId === articleId) ?? null;
}
