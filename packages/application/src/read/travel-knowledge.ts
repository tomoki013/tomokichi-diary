import type {
  ArticleKnowledge,
  Provenance,
  SourceReference,
  TravelFact,
  TravelRoute,
} from "@tomokichi/domain";

export interface TravelKnowledgeView {
  readonly article: ArticleKnowledge;
  readonly facts: readonly TravelFact[];
  readonly sources: readonly SourceReference[];
  readonly routes: readonly TravelRoute[];
}

/** Protocol-neutral projection used by Web, JSON, WebMCP and future MCP adapters. */
export function projectTravelKnowledge(view: TravelKnowledgeView) {
  return {
    schemaVersion: view.article.schemaVersion,
    articleId: view.article.articleId,
    quickAnswer: view.article.quickAnswer,
    decisionTable: view.article.decisionTable,
    experiences: view.article.experienceGroups.map((group) => ({
      ...group,
      facts: group.factIds.flatMap((id) => view.facts.find((fact) => fact.id === id) ?? []),
    })),
    currentFacts: view.article.currentFactIds.flatMap(
      (id) => view.facts.find((fact) => fact.id === id) ?? [],
    ),
    cautions: view.article.cautionFactIds.flatMap(
      (id) => view.facts.find((fact) => fact.id === id) ?? [],
    ),
    routes: view.routes,
    sources: view.sources,
    relatedArticles: view.article.relatedArticles,
  };
}

export function searchTravelFacts(
  facts: readonly TravelFact[],
  input: { readonly text?: string; readonly provenance?: Provenance },
): readonly TravelFact[] {
  const needle = input.text?.trim().toLocaleLowerCase("ja") ?? "";
  return facts.filter(
    (fact) =>
      fact.status === "verified" &&
      (input.provenance === undefined || fact.provenance === input.provenance) &&
      (needle === "" || fact.statement.toLocaleLowerCase("ja").includes(needle)),
  );
}
