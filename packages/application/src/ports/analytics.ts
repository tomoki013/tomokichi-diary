export type SemanticEvent =
  | { readonly name: "article_published"; readonly articleId: string }
  | { readonly name: "knowledge_saved"; readonly articleId: string; readonly factCount: number }
  | {
      readonly name: "firsthand_fact_verified";
      readonly factId: string;
      readonly articleId: string;
    }
  | { readonly name: "travel_knowledge_viewed"; readonly articleId: string }
  | {
      readonly name: "travel_knowledge_searched";
      readonly query: string;
      readonly resultCount: number;
    };

/** Vendor-neutral semantic events. Adapters may forward, log, or deliberately discard them. */
export interface AnalyticsPort {
  track(event: SemanticEvent): void | Promise<void>;
}

export const noOpAnalytics: AnalyticsPort = { track: () => {} };
