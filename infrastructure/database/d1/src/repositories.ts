import type {
  AIArtifactRepository,
  ArticleRepository,
  AuthorRepository,
  EmbedRepository,
  LocationRepository,
  MediaRepository,
  PlaceRepository,
  CollectionRepository,
  ContactMessageRepository,
  RelationRepository,
  Repositories,
  RevisionRepository,
  RouteRepository,
  TaxonomyRepository,
  KnowledgeRepository,
} from "@tomokichi/application";
import {
  aiArtifactRow,
  articleCategoryRow,
  articleCollectionRow,
  articleLocationRow,
  articleMediaRow,
  articlePlaceRow,
  articleRow,
  articleTagRow,
  authorRow,
  categoryRow,
  collectionRow,
  contactMessageRow,
  embedRow,
  locationNameRow,
  locationRow,
  mediaRow,
  placeRow,
  revisionRow,
  routeRow,
  tagRow,
  sourceReferenceRow,
  travelRouteRow,
  travelFactRow,
  articleKnowledgeRow,
  type Row,
} from "@tomokichi/data";
import type { SqlDatabase, SqlStatement } from "./sql.js";

/** `INSERT … ON CONFLICT DO UPDATE` for the given columns — one upsert helper for every table. */
function upsert(
  db: SqlDatabase,
  table: string,
  row: Row,
  keyColumns: readonly string[],
): SqlStatement {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const assignments = columns
    .filter((column) => !keyColumns.includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  const conflict =
    assignments === ""
      ? `ON CONFLICT (${keyColumns.join(", ")}) DO NOTHING`
      : `ON CONFLICT (${keyColumns.join(", ")}) DO UPDATE SET ${assignments}`;
  return db
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ${conflict}`)
    .bind(...columns.map((column) => row[column] ?? null));
}

export function createRepositories(db: SqlDatabase): Repositories {
  const all = (sql: string, ...values: readonly unknown[]): Promise<Row[]> =>
    db
      .prepare(sql)
      .bind(...values)
      .all<Row>() as Promise<Row[]>;
  const first = (sql: string, ...values: readonly unknown[]): Promise<Row | null> =>
    db
      .prepare(sql)
      .bind(...values)
      .first<Row>();

  const articles: ArticleRepository = {
    findById: async (id) => {
      const row = await first("SELECT * FROM articles WHERE id = ?", id);
      return row ? articleRow.to(row) : null;
    },
    findBySlug: async (slug, locale) => {
      const row = await first("SELECT * FROM articles WHERE slug = ? AND locale = ?", slug, locale);
      return row ? articleRow.to(row) : null;
    },
    listAll: async () =>
      (await all("SELECT * FROM articles ORDER BY published_at DESC, created_at DESC")).map(
        articleRow.to,
      ),
    save: async (article) => {
      await upsert(db, "articles", articleRow.from(article), ["id"]).run();
    },
    delete: async (id) => {
      await db.prepare("DELETE FROM articles WHERE id = ?").bind(id).run();
    },
  };

  const articleLikes = {
    count: async (articleId: string) => {
      const row = await first(
        "SELECT COUNT(*) AS count FROM article_likes WHERE article_id = ?",
        articleId,
      );
      return Number(row?.["count"] ?? 0);
    },
    has: async (articleId: string, visitorHash: string) =>
      (await first(
        "SELECT 1 AS found FROM article_likes WHERE article_id = ? AND visitor_hash = ?",
        articleId,
        visitorHash,
      )) !== null,
    add: async (articleId: string, visitorHash: string, createdAt: string) => {
      await db
        .prepare(
          "INSERT INTO article_likes (article_id, visitor_hash, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(articleId, visitorHash, createdAt)
        .run();
    },
    remove: async (articleId: string, visitorHash: string) => {
      await db
        .prepare("DELETE FROM article_likes WHERE article_id = ? AND visitor_hash = ?")
        .bind(articleId, visitorHash)
        .run();
    },
  } satisfies Repositories["articleLikes"];

  const revisions: RevisionRepository = {
    findById: async (id) => {
      const row = await first("SELECT * FROM article_revisions WHERE id = ?", id);
      return row ? revisionRow.to(row) : null;
    },
    findLatest: async (articleId) => {
      const row = await first(
        "SELECT * FROM article_revisions WHERE article_id = ? ORDER BY revision_number DESC LIMIT 1",
        articleId,
      );
      return row ? revisionRow.to(row) : null;
    },
    listByArticle: async (articleId) =>
      (
        await all(
          "SELECT * FROM article_revisions WHERE article_id = ? ORDER BY revision_number DESC",
          articleId,
        )
      ).map(revisionRow.to),
    save: async (revision) => {
      await upsert(db, "article_revisions", revisionRow.from(revision), ["id"]).run();
    },
  };

  const embeds: EmbedRepository = {
    listByRevision: async (revisionId) =>
      (await all("SELECT * FROM article_embeds WHERE revision_id = ?", revisionId)).map(
        embedRow.to,
      ),
    replaceForRevision: async (revisionId, list) => {
      await db.batch([
        db.prepare("DELETE FROM article_embeds WHERE revision_id = ?").bind(revisionId),
        ...list.map((embed) => upsert(db, "article_embeds", embedRow.from(embed), ["id"])),
      ]);
    },
  };

  const routes: RouteRepository = {
    findByPath: async (path) => {
      const row = await first("SELECT * FROM routes WHERE path = ?", path);
      return row ? routeRow.to(row) : null;
    },
    listAll: async () => (await all("SELECT * FROM routes ORDER BY path")).map(routeRow.to),
    save: async (route) => {
      await upsert(db, "routes", routeRow.from(route), ["path"]).run();
    },
    delete: async (path) => {
      await db.prepare("DELETE FROM routes WHERE path = ?").bind(path).run();
    },
  };

  const locations: LocationRepository = {
    listAll: async () => (await all("SELECT * FROM locations ORDER BY slug")).map(locationRow.to),
    listNames: async () => (await all("SELECT * FROM location_names")).map(locationNameRow.to),
    findById: async (id) => {
      const row = await first("SELECT * FROM locations WHERE id = ?", id);
      return row ? locationRow.to(row) : null;
    },
    save: async (location, names) => {
      await db.batch([
        upsert(db, "locations", locationRow.from(location), ["id"]),
        ...names.map((name) =>
          upsert(db, "location_names", locationNameRow.from(name), ["location_id", "locale"]),
        ),
      ]);
    },
  };

  const places: PlaceRepository = {
    listAll: async () => (await all("SELECT * FROM places ORDER BY name")).map(placeRow.to),
    findById: async (id) => {
      const row = await first("SELECT * FROM places WHERE id = ?", id);
      return row ? placeRow.to(row) : null;
    },
    save: async (place) => {
      await upsert(db, "places", placeRow.from(place), ["id"]).run();
    },
  };

  const media: MediaRepository = {
    findById: async (id) => {
      const row = await first("SELECT * FROM media_assets WHERE id = ?", id);
      return row ? mediaRow.to(row) : null;
    },
    findBySha256: async (sha256) => {
      const row = await first("SELECT * FROM media_assets WHERE sha256 = ?", sha256);
      return row ? mediaRow.to(row) : null;
    },
    listAll: async () =>
      (await all("SELECT * FROM media_assets ORDER BY created_at DESC")).map(mediaRow.to),
    save: async (asset) => {
      await upsert(db, "media_assets", mediaRow.from(asset), ["id"]).run();
    },
    listForArticle: async (articleId) =>
      (
        await all("SELECT * FROM article_media WHERE article_id = ? ORDER BY sort_order", articleId)
      ).map(articleMediaRow.to),
    replaceForArticle: async (articleId, list) => {
      await db.batch([
        db.prepare("DELETE FROM article_media WHERE article_id = ?").bind(articleId),
        ...list.map((usage) =>
          upsert(db, "article_media", articleMediaRow.from(usage), [
            "article_id",
            "media_id",
            "role",
          ]),
        ),
      ]);
    },
  };

  const taxonomy: TaxonomyRepository = {
    listCategories: async () =>
      (await all("SELECT * FROM categories ORDER BY sort_order, slug")).map(categoryRow.to),
    listTags: async () => (await all("SELECT * FROM tags ORDER BY slug")).map(tagRow.to),
    findCategoryById: async (id) => {
      const row = await first("SELECT * FROM categories WHERE id = ?", id);
      return row ? categoryRow.to(row) : null;
    },
    findTagById: async (id) => {
      const row = await first("SELECT * FROM tags WHERE id = ?", id);
      return row ? tagRow.to(row) : null;
    },
    saveCategory: async (category) => {
      await upsert(db, "categories", categoryRow.from(category), ["id"]).run();
    },
    saveTag: async (tag) => {
      await upsert(db, "tags", tagRow.from(tag), ["id"]).run();
    },
  };

  const relations: RelationRepository = {
    listArticleLocations: async () =>
      (await all("SELECT * FROM article_locations")).map(articleLocationRow.to),
    listArticlePlaces: async () =>
      (await all("SELECT * FROM article_places")).map(articlePlaceRow.to),
    listArticleCategories: async () =>
      (await all("SELECT * FROM article_categories")).map(articleCategoryRow.to),
    listArticleTags: async () => (await all("SELECT * FROM article_tags")).map(articleTagRow.to),
    replaceForArticle: async (articleId, next) => {
      await db.batch([
        db.prepare("DELETE FROM article_locations WHERE article_id = ?").bind(articleId),
        db.prepare("DELETE FROM article_places WHERE article_id = ?").bind(articleId),
        db.prepare("DELETE FROM article_categories WHERE article_id = ?").bind(articleId),
        db.prepare("DELETE FROM article_tags WHERE article_id = ?").bind(articleId),
        ...next.locations.map((r) =>
          upsert(db, "article_locations", articleLocationRow.from(r), [
            "article_id",
            "location_id",
            "relation",
          ]),
        ),
        ...next.places.map((r) =>
          upsert(db, "article_places", articlePlaceRow.from(r), [
            "article_id",
            "place_id",
            "relation",
          ]),
        ),
        ...next.categories.map((r) =>
          upsert(db, "article_categories", articleCategoryRow.from(r), [
            "article_id",
            "category_id",
          ]),
        ),
        ...next.tags.map((r) =>
          upsert(db, "article_tags", articleTagRow.from(r), ["article_id", "tag_id"]),
        ),
      ]);
    },
  };

  const collections: CollectionRepository = {
    listAll: async () =>
      (await all("SELECT * FROM collections ORDER BY sort_order, slug")).map(collectionRow.to),
    findById: async (id) => {
      const row = await first("SELECT * FROM collections WHERE id = ?", id);
      return row ? collectionRow.to(row) : null;
    },
    save: async (collection) => {
      await upsert(db, "collections", collectionRow.from(collection), ["id"]).run();
    },
    listMemberships: async () =>
      (await all("SELECT * FROM article_collections ORDER BY collection_id, sort_order")).map(
        articleCollectionRow.to,
      ),
    replaceForArticle: async (articleId, memberships) => {
      await db.batch([
        db.prepare("DELETE FROM article_collections WHERE article_id = ?").bind(articleId),
        ...memberships.map((m) =>
          upsert(db, "article_collections", articleCollectionRow.from(m), [
            "article_id",
            "collection_id",
          ]),
        ),
      ]);
    },
  };

  const contactMessages: ContactMessageRepository = {
    save: async (message) => {
      await upsert(db, "contact_messages", contactMessageRow.from(message), ["id"]).run();
    },
    list: async (limit) =>
      (await all("SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT ?", limit)).map(
        contactMessageRow.to,
      ),
    findLatestByIpHash: async (ipHash) => {
      const row = await first(
        "SELECT * FROM contact_messages WHERE ip_hash = ? ORDER BY created_at DESC LIMIT 1",
        ipHash,
      );
      return row ? contactMessageRow.to(row) : null;
    },
    setStatus: async (id, status) => {
      await db
        .prepare("UPDATE contact_messages SET status = ? WHERE id = ?")
        .bind(status, id)
        .run();
    },
    countUnread: async () => {
      const row = await first("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'unread'");
      return Number(row?.["n"] ?? 0);
    },
  };

  const authors: AuthorRepository = {
    findById: async (id) => {
      const row = await first("SELECT * FROM authors WHERE id = ?", id);
      return row ? authorRow.to(row) : null;
    },
    listAll: async () => (await all("SELECT * FROM authors ORDER BY name")).map(authorRow.to),
    save: async (author) => {
      await upsert(db, "authors", authorRow.from(author), ["id"]).run();
    },
  };

  const aiArtifacts: AIArtifactRepository = {
    listForEntity: async (entityType, entityId) =>
      (
        await all(
          "SELECT * FROM ai_artifacts WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC",
          entityType,
          entityId,
        )
      ).map(aiArtifactRow.to),
    save: async (artifact) => {
      await upsert(db, "ai_artifacts", aiArtifactRow.from(artifact), ["id"]).run();
    },
  };

  const knowledge: KnowledgeRepository = {
    listSources: async () =>
      (await all("SELECT * FROM source_references ORDER BY name")).map(sourceReferenceRow.to),
    listTravelRoutes: async () =>
      (await all("SELECT * FROM travel_routes ORDER BY name")).map(travelRouteRow.to),
    listTravelFacts: async () =>
      (await all("SELECT * FROM travel_facts ORDER BY id")).map(travelFactRow.to),
    listArticleKnowledge: async () =>
      (await all("SELECT * FROM article_knowledge ORDER BY article_id")).map(
        articleKnowledgeRow.to,
      ),
    saveSource: async (source) => {
      await upsert(db, "source_references", sourceReferenceRow.from(source), ["id"]).run();
    },
    saveTravelRoute: async (route) => {
      await upsert(db, "travel_routes", travelRouteRow.from(route), ["id"]).run();
    },
    saveTravelFact: async (fact) => {
      await upsert(db, "travel_facts", travelFactRow.from(fact), ["id"]).run();
    },
    saveArticleKnowledge: async (articleKnowledge) => {
      await upsert(db, "article_knowledge", articleKnowledgeRow.from(articleKnowledge), [
        "article_id",
        "revision_id",
      ]).run();
    },
  };

  return {
    articles,
    articleLikes,
    revisions,
    embeds,
    routes,
    locations,
    places,
    media,
    taxonomy,
    relations,
    collections,
    contactMessages,
    authors,
    aiArtifacts,
    knowledge,
  };
}
