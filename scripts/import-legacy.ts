import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { AppContext } from "@tomokichi/application";
import {
  extractImages,
  instantFrom,
  normalizeRoutePath,
  parsePlainDate,
  slugify,
  type Article,
  type ArticleCollection,
  type ArticleEmbed,
  type ArticleId,
  type ArticleLocation,
  type ArticleMedia,
  type ArticleRevision,
  type AuthorId,
  type Category,
  type CategoryId,
  type Collection,
  type CollectionId,
  type Location,
  type LocationId,
  type LocationName,
  type MediaAsset,
  type MediaId,
  type PlainDate,
  type RevisionId,
  type Route,
  type RouteId,
  type RouteTargetType,
  type Slug,
  type Tag,
  type TagId,
} from "@tomokichi/domain";
import { createLocalContext, LOCAL_DB_PATH } from "./lib/local-db.js";
import {
  LEGACY_REPO,
  loadLegacyJourneys,
  loadLegacyRegions,
  loadLegacySeries,
  readLegacyPosts,
  type LegacyRegionNode,
} from "./lib/legacy-source.js";
import { readImageSize } from "./lib/image-size.js";
import { stableId } from "./lib/stable-id.js";

/**
 * One-way import from the Next.js site into the new data model.
 *
 * Deliberately conservative: URLs, titles, descriptions and body text are
 * carried over unchanged, because a technical migration and an editorial
 * rewrite must not happen in the same step (instruction §83).
 */

const WEB_PUBLIC = join(process.cwd(), "apps", "web", "public");
const LEGACY_PUBLIC = join(LEGACY_REPO, "public");
const AUTHOR_ID = stableId("author", "tomokichi") as AuthorId;
const NOW = instantFrom("2026-08-30T00:00:00.000Z");

const CATEGORY_TITLES: Record<string, string> = {
  tourism: "観光情報",
  itinerary: "旅程&費用レポート",
  series: "シリーズ",
  "one-off": "単発企画",
};

const TRAVEL_TOPIC_TITLES: Record<string, string> = {
  money: "お金・決済",
  visa: "ビザ",
  transport: "交通",
  booking: "予約",
  sim: "通信",
  insurance: "保険",
};

/** Pages that exist in the legacy app but hold no article content. */
const STATIC_PAGES = [
  "/",
  "/about",
  "/affiliates",
  "/contact",
  "/cookie-policy",
  "/editorial-policy",
  "/faq",
  "/gallery",
  "/journey",
  "/posts",
  "/privacy",
  "/request",
  "/roadmap",
  "/series",
  "/sitemap",
  "/social",
  "/terms",
  "/destination",
];

/** Legacy pages that declare noindex; the rewrite must not silently start indexing them. */
const NOINDEX_STATIC = new Set([
  "/gallery",
  "/social",
  "/request",
  "/sitemap",
  "/series",
  "/roadmap",
  "/affiliates",
]);

interface Collected {
  locations: Location[];
  locationNames: LocationName[];
  categories: Category[];
  tags: Map<string, Tag>;
  collections: Collection[];
  media: Map<string, MediaAsset>;
  routes: Route[];
}

function route(
  path: string,
  targetType: RouteTargetType,
  targetId: string | null,
  options: Partial<Route> = {},
): Route {
  const normalized = normalizeRoutePath(path);
  return {
    id: stableId("route", normalized) as RouteId,
    path: normalized as Route["path"],
    locale: "ja",
    targetType,
    targetId,
    isCanonical: options.isCanonical ?? true,
    redirectTo: options.redirectTo ?? null,
    redirectStatus: options.redirectStatus ?? null,
    isLegacy: options.isLegacy ?? true,
  };
}

function collectLocations(regions: readonly LegacyRegionNode[]): {
  locations: Location[];
  names: LocationName[];
} {
  const locations: Location[] = [];
  const names: LocationName[] = [];

  const add = (
    node: LegacyRegionNode,
    type: Location["type"],
    parentId: LocationId | null,
  ): LocationId => {
    const id = stableId("location", node.slug) as LocationId;
    locations.push({
      id,
      slug: node.slug as Slug,
      type,
      parentId,
      // The legacy data carries no ISO codes or coordinates; inventing them
      // would be worse than leaving the fields empty for later enrichment.
      countryCode: null,
      subdivisionCode: null,
      latitude: null,
      longitude: null,
      timezone: null,
    });
    names.push({
      locationId: id,
      locale: "ja",
      name: node.name,
      shortName: null,
      romanizedName: node.slug.replaceAll("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    });
    return id;
  };

  // The legacy frontmatter uses `global` for articles that are not about one
  // place; it has no entry in the region tree, so it is created explicitly.
  const globalId = stableId("location", "global") as LocationId;
  locations.push({
    id: globalId,
    slug: "global" as Slug,
    type: "region",
    parentId: null,
    countryCode: null,
    subdivisionCode: null,
    latitude: null,
    longitude: null,
    timezone: null,
  });
  names.push({
    locationId: globalId,
    locale: "ja",
    name: "世界",
    shortName: null,
    romanizedName: "Global",
  });

  for (const continent of regions) {
    const continentId = add(continent, "continent", null);
    for (const country of continent.countries ?? []) {
      const countryId = add(country, "country", continentId);
      for (const child of country.children ?? []) add(child, "city", countryId);
    }
  }
  return { locations, names };
}

async function registerMedia(
  ctx: AppContext,
  collected: Collected,
  publicPath: string,
): Promise<MediaAsset | null> {
  const key = publicPath.replace(/^\/+/, "");
  const existing = collected.media.get(key);
  if (existing) return existing;

  const source = join(LEGACY_PUBLIC, key);
  if (!existsSync(source)) return null;

  const bytes = readFileSync(source);
  const { width, height, size } = readImageSize(source);
  const asset: MediaAsset = {
    id: stableId("media", key) as MediaId,
    storageKey: key,
    mimeType: key.toLowerCase().endsWith(".png")
      ? "image/png"
      : key.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : key.toLowerCase().endsWith(".svg")
          ? "image/svg+xml"
          : "image/jpeg",
    width,
    height,
    size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    createdAt: NOW,
  };
  collected.media.set(key, asset);
  await ctx.repos.media.save(asset);

  // Legacy images keep their existing public URLs, so the rewrite changes no
  // image address (instruction §60). New uploads go to object storage instead.
  const destination = join(WEB_PUBLIC, key);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);

  return asset;
}

function tagFor(collected: Collected, name: string): Tag {
  const existing = collected.tags.get(name);
  if (existing) return existing;
  const slug = (slugify(name) ||
    `tag-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`) as Slug;
  const tag: Tag = { id: stableId("tag", name) as TagId, slug, name };
  collected.tags.set(name, tag);
  return tag;
}

function plainDate(value: string | undefined): PlainDate | null {
  if (!value) return null;
  const parsed = parsePlainDate(value.slice(0, 10));
  return parsed.ok ? parsed.value : null;
}

/** `2024.02.26~02.28` and `2024.09.21~09.30` are the shapes the legacy timeline uses. */
function journeyDates(date: string): { start: PlainDate | null; end: PlainDate | null } {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})(?:~(?:(\d{4})\.)?(\d{2})\.(\d{2}))?/.exec(date);
  if (!match) return { start: null, end: null };
  const [, year, month, day, endYear, endMonth, endDay] = match;
  return {
    start: plainDate(`${year}-${month}-${day}`),
    end: endMonth && endDay ? plainDate(`${endYear ?? year}-${endMonth}-${endDay}`) : null,
  };
}

async function main(): Promise<void> {
  rmSync(LOCAL_DB_PATH, { force: true });
  const ctx: AppContext = await createLocalContext();

  const [regions, legacySeries, legacyJourneys] = await Promise.all([
    loadLegacyRegions(),
    loadLegacySeries(),
    loadLegacyJourneys(),
  ]);
  const posts = readLegacyPosts();

  const { locations, names } = collectLocations(regions);
  const collected: Collected = {
    locations,
    locationNames: names,
    categories: Object.entries(CATEGORY_TITLES).map(([slug, name], index) => ({
      id: stableId("category", slug) as CategoryId,
      slug: slug as Slug,
      name,
      description: null,
      sortOrder: index,
    })),
    tags: new Map(),
    collections: [],
    media: new Map(),
    routes: [],
  };

  await ctx.repos.authors.save({ id: AUTHOR_ID, name: "ともきち", url: null, bio: null });
  for (const category of collected.categories) await ctx.repos.taxonomy.saveCategory(category);

  const locationById = new Map(collected.locations.map((l) => [l.slug as string, l]));
  for (const location of collected.locations) {
    await ctx.repos.locations.save(
      location,
      collected.locationNames.filter((n) => n.locationId === location.id),
    );
    collected.routes.push(route(`/destination/${location.slug}`, "location", location.id));
  }

  for (const [index, series] of legacySeries.entries()) {
    const id = stableId("collection", `series:${series.slug}`) as CollectionId;
    const cover = await registerMedia(ctx, collected, series.imageUrl);
    const collection: Collection = {
      id,
      slug: series.slug as Slug,
      kind: "series",
      title: series.title,
      description: series.description,
      coverMediaId: cover?.id ?? null,
      startDate: null,
      endDate: null,
      sortOrder: index,
    };
    collected.collections.push(collection);
    collected.routes.push(route(`/series/${series.slug}`, "series", id));
  }

  for (const [index, journey] of legacyJourneys.entries()) {
    const id = stableId("collection", `journey:${journey.id}`) as CollectionId;
    const cover = journey.image ? await registerMedia(ctx, collected, journey.image) : null;
    const { start, end } = journeyDates(journey.date);
    collected.collections.push({
      id,
      slug: journey.id as Slug,
      kind: "journey",
      title: journey.title,
      description: journey.description,
      coverMediaId: cover?.id ?? null,
      startDate: start,
      endDate: end,
      sortOrder: index,
    });
    collected.routes.push(route(`/journey/${journey.id}`, "journey", id));
  }

  for (const collection of collected.collections) await ctx.repos.collections.save(collection);

  const missingRegions = new Set<string>();
  const missingImages = new Set<string>();
  let articleCount = 0;

  for (const post of posts) {
    const fm = post.frontmatter;
    const articleId = stableId("article", post.slug) as ArticleId;
    const revisionId = stableId("revision", `${post.slug}:1`) as RevisionId;
    const publishedAt = instantFrom(`${fm.publishedAt}T00:00:00.000Z`);
    const updatedAt = fm.updatedAt ? instantFrom(`${fm.updatedAt}T00:00:00.000Z`) : publishedAt;

    const article: Article = {
      id: articleId,
      status: "published",
      locale: "ja",
      slug: post.slug as Slug,
      authorId: AUTHOR_ID,
      currentRevisionId: revisionId,
      publishedRevisionId: revisionId,
      createdAt: publishedAt,
      updatedAt,
      scheduledAt: null,
      publishedAt,
      archivedAt: null,
      noindex: fm.noindex === true,
      travelStartDate: plainDate(fm.travelDates?.start),
      travelEndDate: plainDate(fm.travelDates?.end),
    };

    // Structured extras the legacy frontmatter carried become embeds, appended
    // where the legacy template rendered them: below the body.
    const embeds: ArticleEmbed[] = [];
    let body = post.body;
    if (fm.promotionPrograms) {
      embeds.push({
        id: stableId("embed", `${post.slug}:promotion`),
        revisionId,
        anchorKey: "promotion-disclosure",
        type: "notice",
        schemaVersion: 1,
        payload: { programs: fm.promotionPrograms },
      });
      body = `{{embed:promotion-disclosure}}\n\n${body}`;
    }
    if (fm.costReport) {
      embeds.push({
        id: stableId("embed", `${post.slug}:cost`),
        revisionId,
        anchorKey: "cost-report",
        type: "table",
        schemaVersion: 1,
        payload: fm.costReport as Record<string, unknown>,
      });
      body = `${body}\n\n{{embed:cost-report}}`;
    }

    const revision: ArticleRevision = {
      id: revisionId,
      articleId,
      revisionNumber: 1,
      title: fm.title,
      summary: fm.excerpt,
      bodyMarkdown: body,
      seoTitleOverride: null,
      seoDescriptionOverride: null,
      changeSummary: "imported from travel-diary",
      createdAt: publishedAt,
      createdBy: AUTHOR_ID,
    };

    await ctx.repos.articles.save({
      ...article,
      currentRevisionId: null,
      publishedRevisionId: null,
    });
    await ctx.repos.revisions.save(revision);
    await ctx.repos.articles.save(article);
    await ctx.repos.embeds.replaceForRevision(revisionId, embeds);

    const media: ArticleMedia[] = [];
    const cover = await registerMedia(ctx, collected, fm.heroImage);
    if (cover) {
      media.push({
        articleId,
        mediaId: cover.id,
        role: "cover",
        sortOrder: 0,
        alt: fm.title,
        caption: null,
      });
    } else {
      missingImages.add(fm.heroImage);
    }
    for (const [index, image] of extractImages(post.body).entries()) {
      if (!image.src.startsWith("/")) continue;
      const asset = await registerMedia(ctx, collected, image.src);
      if (!asset) {
        missingImages.add(image.src);
        continue;
      }
      if (asset.id === cover?.id) continue;
      media.push({
        articleId,
        mediaId: asset.id,
        role: "inline",
        sortOrder: index + 1,
        alt: image.alt || fm.title,
        caption: null,
      });
    }
    await ctx.repos.media.replaceForArticle(articleId, media);

    const articleLocations: ArticleLocation[] = [];
    for (const [index, regionId] of (fm.regionIds ?? []).entries()) {
      const location = locationById.get(regionId);
      if (!location) {
        missingRegions.add(regionId);
        continue;
      }
      articleLocations.push({
        articleId,
        locationId: location.id,
        relation: index === 0 ? "primary" : "mentioned",
      });
    }

    const tags = [
      ...(fm.tags ?? []).map((name) => tagFor(collected, name)),
      ...(fm.travelTopics ?? []).map((topic) =>
        tagFor(collected, TRAVEL_TOPIC_TITLES[topic] ?? topic),
      ),
    ];
    for (const tag of tags) await ctx.repos.taxonomy.saveTag(tag);

    const categoryId = stableId("category", fm.category) as CategoryId;
    await ctx.repos.relations.replaceForArticle(articleId, {
      locations: articleLocations,
      places: [],
      categories: CATEGORY_TITLES[fm.category] ? [{ articleId, categoryId }] : [],
      tags: tags.map((tag) => ({ articleId, tagId: tag.id })),
    });

    const memberships: ArticleCollection[] = [];
    if (fm.series?.slug) {
      memberships.push({
        articleId,
        collectionId: stableId("collection", `series:${fm.series.slug}`) as CollectionId,
        sortOrder: 0,
      });
    }
    if (fm.journeyId) {
      memberships.push({
        articleId,
        collectionId: stableId("collection", `journey:${fm.journeyId}`) as CollectionId,
        sortOrder: 0,
      });
    }
    const knownCollections = new Set(collected.collections.map((c) => c.id as string));
    await ctx.repos.collections.replaceForArticle(
      articleId,
      memberships.filter((m) => knownCollections.has(m.collectionId)),
    );

    collected.routes.push(route(`/posts/${post.slug}`, "article", articleId));
    articleCount++;
  }

  for (const path of STATIC_PAGES) {
    collected.routes.push(route(path, "static", path === "/" ? "home" : path.slice(1)));
  }

  for (const r of collected.routes) await ctx.repos.routes.save(r);

  // The import is only complete when every URL the old site served still
  // resolves; anything else is a silent SEO regression.
  const baselinePath = join(process.cwd(), "migration", "legacy-routes.json");
  const baseline: { path: string }[] = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, "utf8")) as { path: string }[])
    : [];
  const importedPaths = new Set(collected.routes.map((r) => r.path as string));
  const missingRoutes = baseline
    .map((r) => normalizeRoutePath(r.path))
    .filter((p) => !importedPaths.has(p));

  writeFileSync(
    join(process.cwd(), "migration", "import-report.json"),
    `${JSON.stringify(
      {
        articles: articleCount,
        routes: collected.routes.length,
        locations: collected.locations.length,
        collections: collected.collections.length,
        tags: collected.tags.size,
        media: collected.media.size,
        missingRoutes,
        missingRegions: [...missingRegions],
        missingImages: [...missingImages],
        // Carried forward so the rewrite cannot silently start indexing a page
        // the legacy site kept out of the index.
        legacyNoindexStatic: [...NOINDEX_STATIC],
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(
    `✓ import articles ${articleCount} | routes ${collected.routes.length} | locations ${collected.locations.length} | collections ${collected.collections.length} | tags ${collected.tags.size} | media ${collected.media.size}\n`,
  );
  if (missingRoutes.length > 0) {
    process.stdout.write(
      `✗ ROUTE_LEGACY_MISSING ${missingRoutes.length}: ${missingRoutes.slice(0, 10).join(", ")}\n`,
    );
  }
  if (missingRegions.size > 0)
    process.stdout.write(`  unknown regionIds: ${[...missingRegions].join(", ")}\n`);
  if (missingImages.size > 0) process.stdout.write(`  missing images: ${missingImages.size}\n`);
  process.exit(missingRoutes.length > 0 ? 1 : 0);
}

await main();
