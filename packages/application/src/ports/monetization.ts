import type {
  ArticleId,
  RevisionId,
  AdExperiment,
  AffiliateOffer,
  ArticleMonetization,
  MonetizationSettings,
} from "@tomokichi/domain";
export interface MonetizationDraftChange {
  revisionId: RevisionId;
  now: string;
}
export interface MonetizationRepository {
  settings(): Promise<MonetizationSettings>;
  saveSettings(
    settings: MonetizationSettings,
    changes?: readonly (MonetizationDraftChange & { articleId: ArticleId })[],
  ): Promise<void>;
  article(id: ArticleId): Promise<ArticleMonetization>;
  listArticles(): Promise<{ articleId: string; config: ArticleMonetization }[]>;
  saveArticle(
    id: ArticleId,
    config: ArticleMonetization,
    change: MonetizationDraftChange,
  ): Promise<void>;
  offers(): Promise<AffiliateOffer[]>;
  saveOffer(
    offer: AffiliateOffer,
    changes?: readonly (MonetizationDraftChange & { articleId: ArticleId })[],
  ): Promise<void>;
  experiments(): Promise<AdExperiment[]>;
  /** Each save atomically changes metadata and creates an unpublished revision if necessary. */
  saveExperiment(experiment: AdExperiment, change: MonetizationDraftChange): Promise<void>;
}
