import type {
  AdExperiment,
  ArticleDetailDto,
  ArticleMonetization,
  ArticleMonetizationDto,
} from "@tomokichi/contracts";
import type { DraftInput } from "./draft";

/**
 * The admin API calls the ad layout and ad test helpers need. The admin page
 * passes `api`; the operator MCP passes its own token client, so both change
 * ads through the same rules.
 */
export interface AdClient {
  getArticle(articleId: string): Promise<ArticleDetailDto>;
  articleMonetization(articleId: string): Promise<ArticleMonetizationDto>;
  saveDraft(articleId: string, draft: DraftInput): Promise<unknown>;
  saveArticleMonetization(articleId: string, input: ArticleMonetization): Promise<unknown>;
  saveAdExperiment(experiment: AdExperiment): Promise<unknown>;
  controlAdExperiment(experimentId: string, action: "start" | "stop"): Promise<unknown>;
}
