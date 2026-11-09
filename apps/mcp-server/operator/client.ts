import type {
  AdExperiment,
  ArticleMonetization,
  ArticleMonetizationDto,
  MonetizationOverviewDto,
} from "@tomokichi/contracts";
/**
 * The admin API, as the local operator server calls it. Nothing here is
 * deployed: it runs on the operator's machine and talks to `/v1/admin/*` with
 * the same bearer token the admin uses in local development.
 */

export interface OperatorConfig {
  /** API origin, e.g. http://localhost:8787 (wrangler dev) or https://api.tomokichidiary.com. */
  readonly apiUrl: string;
  readonly token: string;
  /** Writes are refused unless the operator turned them on for this session. */
  readonly allowWrites: boolean;
}

export class OperatorError extends Error {}

/** Reads the configuration from the environment and refuses to start half-configured. */
export function configFromEnv(env: Record<string, string | undefined>): OperatorConfig {
  const token =
    env["TOMOKICHI_LOCAL_OPERATOR_TOKEN"]?.trim() || env["TOMOKICHI_ADMIN_TOKEN"]?.trim() || "";
  if (token === "")
    throw new OperatorError(
      "Set TOMOKICHI_LOCAL_OPERATOR_TOKEN (preferred) or TOMOKICHI_ADMIN_TOKEN through the MCP client's env, never in a file in the repository.",
    );
  const apiUrl = (env["TOMOKICHI_API_URL"]?.trim() || "http://localhost:8787").replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new OperatorError(`TOMOKICHI_API_URL is not a URL: ${apiUrl}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  // The token is a bearer secret: it only ever travels over TLS or loopback.
  if (parsed.protocol !== "https:" && !local)
    throw new OperatorError("TOMOKICHI_API_URL must be https unless it is localhost");
  return { apiUrl, token, allowWrites: env["TOMOKICHI_OPERATOR_WRITE"] === "1" };
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface DraftInput {
  title: string;
  summary: string;
  bodyMarkdown: string;
  seoTitleOverride: string | null;
  seoDescriptionOverride: string | null;
  changeSummary: string | null;
}

interface ArticleDetail {
  id: string;
  kind: "article" | "page" | "note";
  slug: string;
  title: string;
  currentRevision: {
    title: string;
    summary: string;
    bodyMarkdown: string;
    seoTitleOverride: string | null;
    seoDescriptionOverride: string | null;
  } | null;
  relations: {
    locations: { locationId: string; relation: string }[];
    places: { placeId: string; relation: string }[];
    categoryIds: string[];
    tagIds: string[];
  };
  collectionIds: string[];
}

export function createOperatorClient(config: OperatorConfig, fetchImpl: Fetch = fetch) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (method !== "GET" && !config.allowWrites)
      throw new OperatorError(
        "書き込みは無効です。MCP クライアントの env に TOMOKICHI_OPERATOR_WRITE=1 を設定したときだけ変更できます。",
      );
    const response = await fetchImpl(`${config.apiUrl}/v1/admin${path}`, {
      method,
      headers: {
        // The remote server reaches the API over a Service Binding instead.
        ...(config.token === "" ? {} : { authorization: `Bearer ${config.token}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      throw new OperatorError(`${method} ${path}: JSON ではない応答（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
      throw new OperatorError(
        `${method} ${path}: HTTP ${response.status} ${error?.code ?? ""} ${error?.message ?? ""}`.trim(),
      );
    }
    return parsed as T;
  }
  const id = encodeURIComponent;

  return {
    config,
    listArticles: () => call<{ items: unknown[] }>("GET", "/articles"),
    listDiaryNotes: () => call<{ items: unknown[]; total: number }>("GET", "/notes"),
    getArticle: (articleId: string) => call<ArticleDetail>("GET", `/articles/${id(articleId)}`),
    async getDiaryNote(noteId: string) {
      const note = await this.getArticle(noteId);
      if (note.kind !== "note") throw new OperatorError(`一言日記が見つかりません: ${noteId}`);
      return note;
    },
    publishCheck: (articleId: string) =>
      call<unknown>("GET", `/articles/${id(articleId)}/publish-check`),
    bodyAudit: () => call<unknown>("GET", "/articles/body-audit"),
    publicationStatus: () => call<unknown>("GET", "/publication"),
    taxonomy: () => call<unknown>("GET", "/taxonomy"),
    listCollections: (kind?: string) =>
      call<{ items: unknown[] }>("GET", `/collections${kind ? `?kind=${id(kind)}` : ""}`),
    searchMedia: (q: string, offset = 0) =>
      call<unknown>(
        "GET",
        `/media?${new URLSearchParams({ q, offset: String(offset), limit: "30" })}`,
      ),

    createArticle: (input: {
      slug: string;
      path: string;
      kind: "article" | "page";
      draft: DraftInput;
    }) => call<{ id: string }>("POST", "/articles", { ...input, locale: "ja" }),

    createDiaryNote: (input: { slug: string; title: string; bodyMarkdown?: string }) =>
      call<{ id: string }>("POST", "/notes", input),

    async saveDiaryNoteDraft(noteId: string, changes: { title?: string; bodyMarkdown?: string }) {
      const current = await this.getDiaryNote(noteId);
      return call<unknown>("PUT", `/notes/${id(noteId)}/draft`, {
        title: changes.title ?? current.currentRevision?.title ?? "",
        bodyMarkdown: changes.bodyMarkdown ?? current.currentRevision?.bodyMarkdown ?? "",
      });
    },

    diaryNotePublishCheck: (noteId: string) =>
      call<unknown>("GET", `/notes/${id(noteId)}/publish-check`),

    async publishDiaryNote(noteId: string) {
      await this.getDiaryNote(noteId);
      const check = await this.diaryNotePublishCheck(noteId);
      const publishable =
        check && typeof check === "object" && "publishable" in check && check.publishable === true;
      if (!publishable)
        throw new OperatorError(
          "公開前検証が通っていません。check_diary_note_publishable を確認してください。",
        );
      return call<unknown>("POST", `/notes/${id(noteId)}/publish`, {});
    },

    async unpublishDiaryNote(noteId: string) {
      await this.getDiaryNote(noteId);
      return call<unknown>("POST", `/notes/${id(noteId)}/unpublish`);
    },

    async setDiaryNoteRelatedArticles(noteId: string, relatedArticleIds: string[]) {
      await this.getDiaryNote(noteId);
      return call<unknown>("PUT", `/notes/${id(noteId)}/related-articles`, { relatedArticleIds });
    },

    /** Saves a new draft revision; fields left out keep their current value. */
    async saveDraft(articleId: string, changes: Partial<DraftInput>) {
      const article = await this.getArticle(articleId);
      if (article.kind === "note")
        throw new OperatorError("一言日記には save_diary_note_draft を使ってください");
      const current = article.currentRevision;
      const draft: DraftInput = {
        title: changes.title ?? current?.title ?? "",
        summary: changes.summary ?? current?.summary ?? "",
        bodyMarkdown: changes.bodyMarkdown ?? current?.bodyMarkdown ?? "",
        seoTitleOverride: changes.seoTitleOverride ?? current?.seoTitleOverride ?? null,
        seoDescriptionOverride:
          changes.seoDescriptionOverride ?? current?.seoDescriptionOverride ?? null,
        changeSummary: changes.changeSummary ?? "MCP operator",
      };
      return call<unknown>("PUT", `/articles/${id(articleId)}/draft`, draft);
    },

    /**
     * Replaces only the series and tags of an article; locations, places and
     * categories are sent back exactly as they are.
     */
    async setSeriesAndTags(
      articleId: string,
      changes: { collectionIds?: string[]; tagIds?: string[] },
    ) {
      const article = await this.getArticle(articleId);
      return call<unknown>("PUT", `/articles/${id(articleId)}/relations`, {
        locations: article.relations.locations,
        places: article.relations.places,
        categoryIds: article.relations.categoryIds,
        tagIds: changes.tagIds ?? article.relations.tagIds,
        collectionIds: changes.collectionIds ?? article.collectionIds,
      });
    },

    monetization: () => call<MonetizationOverviewDto>("GET", "/monetization"),
    articleMonetization: (articleId: string) =>
      call<ArticleMonetizationDto>("GET", `/monetization/articles/${id(articleId)}`),
    saveArticleMonetization: (articleId: string, input: ArticleMonetization) =>
      call<unknown>("PUT", `/monetization/articles/${id(articleId)}`, input),
    saveAdExperiment: (experiment: AdExperiment) =>
      call<unknown>("PUT", `/monetization/experiments/${id(experiment.id)}`, experiment),
    controlAdExperiment: (experimentId: string, action: "start" | "stop") =>
      call<unknown>("POST", `/monetization/experiments/${id(experimentId)}/${action}`),

    async publish(articleId: string) {
      const article = await this.getArticle(articleId);
      if (article.kind === "note")
        throw new OperatorError("一言日記には publish_diary_note を使ってください");
      return call<unknown>("POST", `/articles/${id(articleId)}/publish`, {});
    },
    createSeries: (input: {
      slug: string;
      title: string;
      description?: string | null;
      coverMediaId?: string | null;
      sortOrder?: number | null;
    }) => call<unknown>("POST", "/collections", { ...input, kind: "series" }),
    updateSeries: (
      collectionId: string,
      input: {
        title?: string;
        description?: string | null;
        coverMediaId?: string | null;
        sortOrder?: number;
      },
    ) => call<unknown>("PATCH", `/collections/${id(collectionId)}`, input),
    createTag: (input: { slug: string; name: string }) => call<unknown>("POST", "/tags", input),
    listRankings: () => call<{ items: unknown[] }>("GET", "/rankings"),
    createRanking: (input: RankingChanges & { title: string }) =>
      call<unknown>("POST", "/rankings", input),
    updateRanking: (rankingId: string, input: RankingChanges) =>
      call<unknown>("PATCH", `/rankings/${id(rankingId)}`, input),
    publishSite: () => call<unknown>("POST", "/publication/retry", {}),
  };
}

export interface RankingChanges {
  title?: string;
  note?: string;
  experienceTag?: string | null;
  photoMediaId?: string | null;
  picks?: { articleId: string; comment: string }[];
  sortOrder?: number;
}

export type OperatorClient = ReturnType<typeof createOperatorClient>;
