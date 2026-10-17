import { beforeEach, expect, it } from "vitest";
import {
  defaultArticleMonetization,
  type AdExperiment,
  type ArticleId,
  type RevisionId,
} from "@tomokichi/domain";
import { fromNodeSqlite, openInMemoryDatabase } from "../node-sqlite.js";
import { migrate } from "../migrator.js";
import { loadMigrations } from "./context.js";
import { createMonetizationRepository } from "../monetization.js";
let native: ReturnType<typeof openInMemoryDatabase>;
let repo: ReturnType<typeof createMonetizationRepository>;
const articleId = "article" as ArticleId;
const now = "2026-10-17T00:00:00.000Z";
beforeEach(async () => {
  native = openInMemoryDatabase();
  const db = fromNodeSqlite(native);
  await migrate(db, loadMigrations());
  repo = createMonetizationRepository(db);
  native.exec(`INSERT INTO authors(id,name) VALUES('author','ともきち');
    INSERT INTO articles(id,status,locale,slug,author_id,current_revision_id,published_revision_id,created_at,updated_at) VALUES('article','published','ja','article','author','revision-one','revision-one','2026-10-17T00:00:00.000Z','2026-10-17T00:00:00.000Z');
    INSERT INTO article_revisions(id,article_id,revision_number,title,summary,body_markdown,created_at,created_by) VALUES('revision-one','article',1,'Title','Summary','Body','2026-10-17T00:00:00.000Z','author');`);
});
it("rolls back the unpublished revision along with a failed placement save", async () => {
  const config = {
    ...defaultArticleMonetization(),
    updatedAt: now,
    placements: [
      {
        key: "planned",
        kind: "affiliate" as const,
        position: "article_end" as const,
        status: "ready" as const,
        adUnit: "7152502134",
        offerId: "missing-offer",
      },
    ],
  };
  await expect(
    repo.saveArticle(articleId, config, { revisionId: "revision-two" as RevisionId, now }),
  ).rejects.toThrow();
  expect(
    native.prepare("SELECT current_revision_id FROM articles WHERE id='article'").get()
      ?.current_revision_id,
  ).toBe("revision-one");
  expect(native.prepare("SELECT COUNT(*) AS count FROM article_revisions").get()?.count).toBe(1);
  expect(native.prepare("SELECT COUNT(*) AS count FROM article_monetization").get()?.count).toBe(0);
  await repo.saveArticle(
    articleId,
    { ...defaultArticleMonetization(), mode: "none", updatedAt: now },
    { revisionId: "revision-two" as RevisionId, now },
  );
  expect(
    native.prepare("SELECT current_revision_id FROM articles WHERE id='article'").get()
      ?.current_revision_id,
  ).toBe("revision-two");
  expect((await repo.article(articleId)).mode).toBe("none");
});
it("rolls back publication dirtiness if an experiment write fails", async () => {
  const experiment = {
    id: "test",
    articleId,
    name: "Test",
    markerKey: "planned",
    adUnitA: "7152502134",
    adUnitB: "7152502134",
    shareB: 50,
    status: "invalid",
    startedAt: null,
    stoppedAt: null,
    updatedAt: now,
  } as unknown as AdExperiment;
  await expect(
    repo.saveExperiment(experiment, { revisionId: "revision-two" as RevisionId, now }),
  ).rejects.toThrow();
  expect(
    native.prepare("SELECT current_revision_id FROM articles WHERE id='article'").get()
      ?.current_revision_id,
  ).toBe("revision-one");
  expect(native.prepare("SELECT COUNT(*) AS count FROM article_revisions").get()?.count).toBe(1);
});
it("rolls back linked article revisions when an offer update fails its status constraint", async () => {
  const offer = {
    id: "offer",
    name: "Offer",
    provider: "Trip.com",
    category: "travel",
    heading: "Book",
    description: "Compare",
    imageUrl: null,
    url: "https://www.trip.com/t/FixtureLink",
    format: "booking_card" as const,
    notes: "",
    status: "ready" as const,
    checkedAt: now,
    updatedAt: now,
  };
  await repo.saveOffer(offer);
  await expect(
    repo.saveOffer({ ...offer, status: "invalid" as never }, [
      { articleId, revisionId: "revision-two" as RevisionId, now },
    ]),
  ).rejects.toThrow();
  expect(
    native.prepare("SELECT current_revision_id FROM articles WHERE id='article'").get()
      ?.current_revision_id,
  ).toBe("revision-one");
  expect((await repo.offers())[0]?.status).toBe("ready");
});
