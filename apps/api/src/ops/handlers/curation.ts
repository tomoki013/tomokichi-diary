import {
  createCollection,
  createRanking,
  createTag,
  updateCollection,
  updateRanking,
  type AppContext,
} from "@tomokichi/application";
import type {
  CollectionAdminDto,
  CollectionArticleDefaultsDto,
  RankingAdminDto,
} from "@tomokichi/contracts";
import {
  EXPERIENCE_TAGS,
  isPubliclyVisible,
  type ArticleCategory,
  type ArticleTag,
  type Collection,
  type CollectionId,
  type MediaId,
  type RankingId,
  type RevisionId,
} from "@tomokichi/domain";
import { thumbnailKey, toLocationDto } from "../../mappers.js";
import { invalid, notFound, unwrap, type Handlers } from "../scope.js";

type Names =
  | "series.list"
  | "series.get"
  | "series.create"
  | "series.update"
  | "tag.create"
  | "taxonomy.get"
  | "location.list"
  | "place.list"
  | "ranking.list"
  | "ranking.get"
  | "ranking.create"
  | "ranking.update";

function count(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/**
 * What most members already carry: an experience tag on at least half of
 * them, a tag or category on at least half and on two or more (one article's
 * place names are not what the series is about).
 */
function suggestDefaults(
  members: readonly string[],
  experienceTagsOf: (articleId: string) => readonly string[],
  articleTags: readonly ArticleTag[],
  articleCategories: readonly ArticleCategory[],
): CollectionArticleDefaultsDto {
  const ids = new Set(members);
  const half = members.length / 2;
  const common = (values: readonly string[], minimum: number) =>
    [...count(values)]
      .filter(([, n]) => n >= minimum && n >= half)
      .toSorted((a, b) => b[1] - a[1])
      .map(([value]) => value);
  const experiences = common(members.flatMap(experienceTagsOf), 1);
  return {
    tagIds: common(
      articleTags.filter((t) => ids.has(t.articleId)).map((t) => t.tagId),
      2,
    ).slice(0, 5),
    categoryIds: common(
      articleCategories.filter((c) => ids.has(c.articleId)).map((c) => c.categoryId),
      2,
    ).slice(0, 2),
    experienceTags: EXPERIENCE_TAGS.filter((tag) => experiences.includes(tag)),
  };
}

/** Builds the DTOs for every collection in one pass over the tables. */
async function collectionDtos(ctx: AppContext, only?: CollectionId): Promise<CollectionAdminDto[]> {
  const [collections, memberships, articles, routes, articleTags, articleCategories] =
    await Promise.all([
      ctx.repos.collections.listAll(),
      ctx.repos.collections.listMemberships(),
      ctx.repos.articles.listAll(),
      ctx.repos.routes.listAll(),
      ctx.repos.relations.listArticleTags(),
      ctx.repos.relations.listArticleCategories(),
    ]);
  const experienceTags = new Map<string, readonly string[]>(
    articles.map((article) => [article.id, article.experienceTags]),
  );
  const now = ctx.clock.now();
  const live = new Set(
    articles.filter((article) => isPubliclyVisible(article, now)).map((article) => article.id),
  );
  const chosen = only ? collections.filter((item) => item.id === only) : collections;
  const items = await Promise.all(
    chosen.map(async (collection: Collection) => {
      const members = memberships.filter((m) => m.collectionId === collection.id);
      const route = routes.find(
        (r) => r.targetType === collection.kind && r.targetId === collection.id && r.isCanonical,
      );
      const cover = collection.coverMediaId
        ? await ctx.repos.media.findById(collection.coverMediaId)
        : null;
      const thumb = cover ? thumbnailKey(cover) : null;
      return {
        id: collection.id,
        slug: collection.slug,
        kind: collection.kind,
        title: collection.title,
        description: collection.description,
        coverMediaId: collection.coverMediaId,
        coverUrl: cover ? ctx.mediaUrls.resolve(thumb ?? cover.storageKey) : null,
        sortOrder: collection.sortOrder,
        path: route?.path ?? null,
        publishedCount: members.filter((m) => live.has(m.articleId)).length,
        memberCount: members.length,
        themeMusic: collection.themeMusic,
        articleDefaults: collection.articleDefaults,
        suggestedDefaults: suggestDefaults(
          members.map((m) => m.articleId),
          (articleId) => experienceTags.get(articleId) ?? [],
          articleTags,
          articleCategories,
        ),
        updatedAt: collection.updatedAt,
      };
    }),
  );
  return items.toSorted((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}

/** Builds ranking DTOs, naming picks and resolving the manually chosen photo. */
async function rankingDtos(ctx: AppContext, only?: RankingId): Promise<RankingAdminDto[]> {
  const [rankings, articles] = await Promise.all([
    ctx.repos.rankings.listAll(),
    ctx.repos.articles.listAll(),
  ]);
  const chosen = only ? rankings.filter((item) => item.id === only) : rankings;
  const picked = new Set(chosen.flatMap((ranking) => ranking.picks.map((pick) => pick.articleId)));
  const articleById = new Map(articles.filter((a) => picked.has(a.id)).map((a) => [a.id, a]));
  const revisions = await ctx.repos.revisions.listByIds(
    [...articleById.values()].flatMap((a) =>
      a.currentRevisionId ? [a.currentRevisionId as RevisionId] : [],
    ),
  );
  const titleOf = new Map(revisions.map((revision) => [revision.articleId, revision.title]));
  const photoIds = [
    ...new Set(
      chosen
        .map((ranking) => ranking.photoMediaId)
        .filter((photoId): photoId is MediaId => photoId !== null),
    ),
  ];
  const photos = await Promise.all(photoIds.map((photoId) => ctx.repos.media.findById(photoId)));
  const photoById = new Map(
    photos.filter((photo) => photo !== null).map((photo) => [photo.id, photo]),
  );
  const now = ctx.clock.now();
  return chosen.map((ranking) => {
    const photo = ranking.photoMediaId ? (photoById.get(ranking.photoMediaId) ?? null) : null;
    const thumbnail = photo ? thumbnailKey(photo) : null;
    const picks = ranking.picks.map((pick) => {
      const article = articleById.get(pick.articleId);
      return {
        articleId: pick.articleId,
        comment: pick.comment,
        slug: article?.slug ?? "",
        title: titleOf.get(pick.articleId) ?? article?.slug ?? "",
        live: article ? isPubliclyVisible(article, now) : false,
      };
    });
    return {
      id: ranking.id,
      title: ranking.title,
      note: ranking.note,
      experienceTag: ranking.experienceTag,
      photo: photo
        ? {
            mediaId: photo.id,
            url: ctx.mediaUrls.resolve(photo.storageKey),
            thumbnailUrl: thumbnail ? ctx.mediaUrls.resolve(thumbnail) : null,
            label: photo.slug ?? photo.originalName ?? photo.id,
          }
        : null,
      sortOrder: ranking.sortOrder,
      picks,
      liveCount: picks.filter((pick) => pick.live).length,
      updatedAt: ranking.updatedAt,
    };
  });
}

/** Lets a caller name articles by slug, as the author does in conversation. */
async function resolvePicks(
  ctx: AppContext,
  picks: readonly { article: string; comment: string }[],
): Promise<{ articleId: string; comment: string }[]> {
  const articles = await ctx.repos.articles.listAll();
  return picks.map(({ article, comment }) => {
    const found = articles.find((a) => a.id === article || a.slug === article);
    if (!found) throw invalid(`記事が見つかりません: ${article}`, "picks");
    return { articleId: found.id, comment };
  });
}

/** Only the keys the caller sent: the use case reads an absent key as "unchanged". */
function present<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

async function oneCollection(ctx: AppContext, id: CollectionId): Promise<CollectionAdminDto> {
  const [item] = await collectionDtos(ctx, id);
  if (!item) throw notFound("COLLECTION_NOT_FOUND", `no collection ${id}`);
  return item;
}

async function oneRanking(ctx: AppContext, id: RankingId): Promise<RankingAdminDto> {
  const [item] = await rankingDtos(ctx, id);
  if (!item) throw notFound("RANKING_NOT_FOUND", `no ranking ${id}`);
  return item;
}

/**
 * Series and journeys, tags and the home page's rankings. Created and edited
 * here; never deleted, so an existing URL cannot vanish by mistake. Changes
 * reach the site with the next publication.
 */
export const curationHandlers: Handlers<Names> = {
  "series.list": async ({ ctx }, { kind }) => {
    const items = await collectionDtos(ctx);
    return { items: kind ? items.filter((item) => item.kind === kind) : items };
  },

  "series.get": ({ ctx }, { collectionId }) => oneCollection(ctx, collectionId as CollectionId),

  "series.create": async ({ ctx }, input) => {
    const created = unwrap(await createCollection(ctx, input));
    return oneCollection(ctx, created.collection.id);
  },

  "series.update": async ({ ctx }, { collectionId, ...changes }) => {
    const id = collectionId as CollectionId;
    unwrap(await updateCollection(ctx, id, present(changes)));
    return oneCollection(ctx, id);
  },

  "tag.create": async ({ ctx }, input) => {
    const tag = unwrap(await createTag(ctx, input));
    return { id: tag.id, slug: tag.slug, name: tag.name };
  },

  "taxonomy.get": async ({ ctx }) => {
    const [categories, tags, collections] = await Promise.all([
      ctx.repos.taxonomy.listCategories(),
      ctx.repos.taxonomy.listTags(),
      ctx.repos.collections.listAll(),
    ]);
    return {
      categories: categories.map(({ id, slug, name }) => ({ id, slug, name })),
      tags: tags.map(({ id, slug, name }) => ({ id, slug, name })),
      collections: collections.map((collection) => ({
        id: collection.id,
        slug: collection.slug,
        kind: collection.kind,
        title: collection.title,
        articleDefaults: collection.articleDefaults,
      })),
    };
  },

  "location.list": async ({ ctx }) => {
    const [locations, names] = await Promise.all([
      ctx.repos.locations.listAll(),
      ctx.repos.locations.listNames(),
    ]);
    return { items: locations.map((location) => toLocationDto(location, names)) };
  },

  "place.list": async ({ ctx }) => ({
    items: (await ctx.repos.places.listAll()).map((place) => ({
      id: place.id,
      slug: place.slug,
      name: place.name,
      kind: place.kind,
      locationId: place.locationId,
    })),
  }),

  "ranking.list": async ({ ctx }) => ({ items: await rankingDtos(ctx) }),

  "ranking.get": ({ ctx }, { rankingId }) => oneRanking(ctx, rankingId as RankingId),

  "ranking.create": async ({ ctx }, { picks, ...rest }) => {
    const created = unwrap(
      await createRanking(ctx, {
        ...present(rest),
        ...(picks ? { picks: await resolvePicks(ctx, picks) } : {}),
      }),
    );
    return oneRanking(ctx, created.id);
  },

  "ranking.update": async ({ ctx }, { rankingId, picks, ...rest }) => {
    const id = rankingId as RankingId;
    unwrap(
      await updateRanking(ctx, id, {
        ...present(rest),
        ...(picks ? { picks: await resolvePicks(ctx, picks) } : {}),
      }),
    );
    return oneRanking(ctx, id);
  },
};
