import type { MonetizationRepository } from "@tomokichi/application";
import {
  type ArticleId,
  type RevisionId,
  DEFAULT_MONETIZATION_SETTINGS,
  defaultArticleMonetization,
  type ArticleMonetization,
  type MonetizationSettings,
  type AffiliateOffer,
  type AdExperiment,
} from "@tomokichi/domain";
import type { SqlDatabase, SqlStatement } from "./sql.js";
export function createMonetizationRepository(db: SqlDatabase): MonetizationRepository {
  async function read<T>(table: string): Promise<T[]> {
    return (
      await db
        .prepare(`SELECT payload FROM ${table} ORDER BY updated_at DESC`)
        .all<{ payload: string }>()
    ).map((r) => JSON.parse(r.payload) as T);
  }
  function draftStatements(id: ArticleId, rid: RevisionId, now: string): SqlStatement[] {
    return [
      db
        .prepare(
          `INSERT INTO article_revisions (id,article_id,revision_number,title,summary,body_markdown,seo_title_override,seo_description_override,change_summary,created_by,created_at)
        SELECT ?,article_id,revision_number+1,title,summary,body_markdown,seo_title_override,seo_description_override,'収益化設定',created_by,? FROM article_revisions
        WHERE id=(SELECT current_revision_id FROM articles WHERE id=? AND current_revision_id=published_revision_id)`,
        )
        .bind(rid, now, id),
      db
        .prepare(
          `INSERT INTO article_embeds(id,revision_id,anchor_key,type,schema_version,payload)
        SELECT ? || '-' || id,?,anchor_key,type,schema_version,payload FROM article_embeds WHERE revision_id=(SELECT current_revision_id FROM articles WHERE id=?) AND EXISTS(SELECT 1 FROM article_revisions WHERE id=?)`,
        )
        .bind(rid, rid, id, rid),
      db
        .prepare(
          `INSERT INTO article_knowledge(article_id,revision_id,schema_version,quick_answer_json,decision_table_json,experience_groups_json,current_fact_ids_json,caution_fact_ids_json,route_ids_json,related_articles_json)
        SELECT article_id,?,schema_version,quick_answer_json,decision_table_json,experience_groups_json,current_fact_ids_json,caution_fact_ids_json,route_ids_json,related_articles_json FROM article_knowledge WHERE article_id=? AND revision_id=(SELECT current_revision_id FROM articles WHERE id=?) AND EXISTS(SELECT 1 FROM article_revisions WHERE id=?)`,
        )
        .bind(rid, id, id, rid),
      db
        .prepare(
          "UPDATE articles SET current_revision_id=? WHERE id=? AND EXISTS(SELECT 1 FROM article_revisions WHERE id=?)",
        )
        .bind(rid, id, rid),
    ];
  }
  return {
    settings: async () =>
      (await read<MonetizationSettings>("monetization_settings"))[0] ??
      structuredClone(DEFAULT_MONETIZATION_SETTINGS),
    saveSettings: async (s, changes = []) => {
      await db.batch([
        ...changes.flatMap((c) => draftStatements(c.articleId, c.revisionId, c.now)),
        db
          .prepare(
            "INSERT INTO monetization_settings(id,payload,updated_at) VALUES('site',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
          )
          .bind(JSON.stringify(s), s.updatedAt),
      ]);
    },
    article: async (id) => {
      const row = await db
        .prepare("SELECT payload FROM article_monetization WHERE article_id=?")
        .bind(id)
        .first<{ payload: string }>();
      return row ? (JSON.parse(row.payload) as ArticleMonetization) : defaultArticleMonetization();
    },
    listArticles: async () =>
      (
        await db
          .prepare("SELECT article_id,payload FROM article_monetization")
          .all<{ article_id: string; payload: string }>()
      ).map((r) => ({ articleId: r.article_id, config: JSON.parse(r.payload) })),
    saveArticle: async (id, c, change) => {
      await db.batch([
        ...draftStatements(id, change.revisionId, change.now),
        db
          .prepare(
            "INSERT INTO article_monetization(article_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(article_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
          )
          .bind(id, JSON.stringify(c), c.updatedAt),
        db.prepare("DELETE FROM monetization_placements WHERE article_id=?").bind(id),
        ...c.placements.map((p) =>
          db
            .prepare(
              "INSERT INTO monetization_placements(article_id,placement_key,offer_id) VALUES(?,?,?)",
            )
            .bind(id, p.key, p.offerId),
        ),
      ]);
    },
    offers: () => read<AffiliateOffer>("affiliate_offers"),
    saveOffer: async (o, changes = []) => {
      await db.batch([
        ...changes.flatMap((c) => draftStatements(c.articleId, c.revisionId, c.now)),
        db
          .prepare(
            "INSERT INTO affiliate_offers(id,status,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at",
          )
          .bind(o.id, o.status, JSON.stringify(o), o.updatedAt),
      ]);
    },
    experiments: () => read<AdExperiment>("ad_experiments"),
    saveExperiment: async (e, change) => {
      await db.batch([
        ...draftStatements(e.articleId as ArticleId, change.revisionId, change.now),
        db
          .prepare(
            "INSERT INTO ad_experiments(id,article_id,status,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at",
          )
          .bind(e.id, e.articleId, e.status, JSON.stringify(e), e.updatedAt),
      ]);
    },
  };
}
