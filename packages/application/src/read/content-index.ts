import {
  LocationTree,
  RouteTable,
  findRelatedArticles,
  isIndexable,
  isPubliclyVisible,
  listPublicArticles,
  type Article,
  type ArticleEmbed,
  type ArticleId,
  type ArticleMedia,
  type ArticleRevision,
  type Author,
  type Category,
  type Collection,
  type CollectionId,
  type Instant,
  type Location,
  type MediaAsset,
  type Place,
  type RelationIndex,
  type Relation,
  type Route,
  type Tag,
} from "@tomokichi/domain";
import type { ContentSnapshot } from "@tomokichi/data";

export interface ArticleView {
  readonly article: Article;
  readonly revision: ArticleRevision;
  readonly route: Route;
  readonly author: Author | null;
  readonly embeds: readonly ArticleEmbed[];
  readonly cover: { readonly usage: ArticleMedia; readonly asset: MediaAsset } | null;
  readonly media: readonly { readonly usage: ArticleMedia; readonly asset: MediaAsset }[];
  readonly categories: readonly Category[];
  readonly tags: readonly Tag[];
  readonly locations: readonly { readonly location: Location; readonly relation: Relation }[];
  readonly places: readonly { readonly place: Place; readonly relation: Relation }[];
}

/**
 * Read model over a snapshot. Everything the public site renders is assembled
 * here, so page templates stay free of joins and business rules
 * (instruction §41).
 */
export class ContentIndex {
  readonly routes: RouteTable;
  readonly locations: LocationTree;
  readonly relations: RelationIndex;

  private readonly articleById = new Map<ArticleId, Article>();
  private readonly revisionById = new Map<string, ArticleRevision>();
  private readonly mediaById = new Map<string, MediaAsset>();
  private readonly authorById = new Map<string, Author>();
  private readonly categoryById = new Map<string, Category>();
  private readonly tagById = new Map<string, Tag>();
  private readonly placeById = new Map<string, Place>();
  private readonly collectionById = new Map<string, Collection>();

  constructor(
    readonly snapshot: ContentSnapshot,
    readonly now: Instant,
  ) {
    this.routes = new RouteTable(snapshot.routes);
    this.locations = new LocationTree(snapshot.locations, snapshot.locationNames);
    this.relations = {
      categories: snapshot.articleCategories,
      tags: snapshot.articleTags,
      locations: snapshot.articleLocations,
      places: snapshot.articlePlaces,
    };
    for (const a of snapshot.articles) this.articleById.set(a.id, a);
    for (const r of snapshot.revisions) this.revisionById.set(r.id, r);
    for (const m of snapshot.media) this.mediaById.set(m.id, m);
    for (const a of snapshot.authors) this.authorById.set(a.id, a);
    for (const c of snapshot.categories) this.categoryById.set(c.id, c);
    for (const t of snapshot.tags) this.tagById.set(t.id, t);
    for (const p of snapshot.places) this.placeById.set(p.id, p);
    for (const c of snapshot.collections) this.collectionById.set(c.id, c);
  }

  publicArticles(): readonly Article[] {
    return listPublicArticles({ articles: this.snapshot.articles, now: this.now });
  }

  /** Standalone pages (about, FAQ, legal), which listings and feeds exclude. */
  publicPages(): readonly Article[] {
    return listPublicArticles({
      articles: this.snapshot.articles,
      filter: { kind: "page" },
      now: this.now,
    });
  }

  indexableArticles(): readonly Article[] {
    return this.publicArticles().filter((a) => isIndexable(a, this.now));
  }

  titleOf(id: ArticleId): string {
    const article = this.articleById.get(id);
    const revisionId = article?.publishedRevisionId;
    return revisionId ? (this.revisionById.get(revisionId)?.title ?? "") : "";
  }

  /** Null when the article is not publicly renderable — callers never see drafts. */
  viewOf(id: ArticleId): ArticleView | null {
    const article = this.articleById.get(id);
    if (!article || !isPubliclyVisible(article, this.now)) return null;
    return this.buildView(article, this.revisionById.get(article.publishedRevisionId!) ?? null);
  }

  /** Preview renders an arbitrary revision without consulting publication state. */
  previewOf(article: Article, revision: ArticleRevision): ArticleView | null {
    return this.buildView(article, revision);
  }

  private buildView(article: Article, revision: ArticleRevision | null): ArticleView | null {
    // Standalone pages are addressed in the static namespace, articles in the
    // article one; both are content and both need their route to render.
    const route = this.routes.canonicalFor(
      article.kind === "page" ? "static" : "article",
      article.id,
    );
    if (!revision || !route) return null;

    const media = this.snapshot.articleMedia
      .filter((m) => m.articleId === article.id)
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((usage) => {
        const asset = this.mediaById.get(usage.mediaId);
        return asset ? [{ usage, asset }] : [];
      });

    return {
      article,
      revision,
      route,
      author: this.authorById.get(article.authorId) ?? null,
      embeds: this.snapshot.embeds.filter((e) => e.revisionId === revision.id),
      cover: media.find((m) => m.usage.role === "cover") ?? null,
      media,
      categories: this.relations.categories
        .filter((r) => r.articleId === article.id)
        .flatMap((r) => {
          const c = this.categoryById.get(r.categoryId);
          return c ? [c] : [];
        }),
      tags: this.relations.tags
        .filter((r) => r.articleId === article.id)
        .flatMap((r) => {
          const t = this.tagById.get(r.tagId);
          return t ? [t] : [];
        }),
      locations: this.relations.locations
        .filter((r) => r.articleId === article.id)
        .flatMap((r) => {
          const l = this.locations.get(r.locationId);
          return l ? [{ location: l, relation: r.relation }] : [];
        }),
      places: this.relations.places
        .filter((r) => r.articleId === article.id)
        .flatMap((r) => {
          const p = this.placeById.get(r.placeId);
          return p ? [{ place: p, relation: r.relation }] : [];
        }),
    };
  }

  relatedTo(id: ArticleId, limit = 6): readonly ArticleView[] {
    return findRelatedArticles({
      articleId: id,
      articles: this.snapshot.articles,
      relations: this.relations,
      now: this.now,
      limit,
    }).flatMap((r) => {
      const view = this.viewOf(r.articleId);
      return view ? [view] : [];
    });
  }

  collectionsOf(id: ArticleId): readonly Collection[] {
    return this.snapshot.articleCollections
      .filter((m) => m.articleId === id)
      .flatMap((m) => {
        const collection = this.collectionById.get(m.collectionId);
        return collection ? [collection] : [];
      });
  }

  /** Members of a collection in editorial order, drafts excluded. */
  membersOf(collectionId: CollectionId): readonly ArticleView[] {
    return this.snapshot.articleCollections
      .filter((m) => m.collectionId === collectionId)
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((m) => {
        const view = this.viewOf(m.articleId);
        return view ? [view] : [];
      });
  }

  collection(id: CollectionId): Collection | null {
    return this.collectionById.get(id) ?? null;
  }

  primaryLocationOf(id: ArticleId): Location | null {
    const relation =
      this.relations.locations.find((r) => r.articleId === id && r.relation === "primary") ??
      this.relations.locations.find((r) => r.articleId === id);
    return relation ? (this.locations.get(relation.locationId) ?? null) : null;
  }
}
