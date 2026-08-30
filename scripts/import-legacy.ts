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
  LocationTree,
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
import { readLegacyPages } from "./lib/legacy-pages.js";
import { readImageSize } from "./lib/image-size.js";
import { stableId } from "./lib/stable-id.js";

/**
 * One-way import from the Next.js site into the new data model.
 *
 * Deliberately conservative: URLs, titles, descriptions and body text are
 * carried over unchanged, because a technical migration and an editorial
 * rewrite must not happen in the same step (instruction §83).
 */

// Originals live outside every app bundle: they are delivered from object
// storage, not from the site Worker.
const MEDIA_DIR = join(process.cwd(), "media");
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

/**
 * Pages that hold no article content, with the tidied URL structure.
 *
 * Article URLs are frozen; everything else was free to move, so the legal and
 * disclosure pages are grouped under `/legal` and the trip timeline moved off
 * the opaque `/journey/j-2024-02-26` ids. Every old path is kept alive as a
 * 301 (see `LEGACY_STATIC_REDIRECTS`).
 */
interface StaticPage {
  path: string;
  key: string;
  noindex?: boolean;
}

const STATIC_PAGES: StaticPage[] = [
  { path: "/", key: "home" },
  { path: "/posts", key: "posts" },
  { path: "/destination", key: "destination" },
  { path: "/collections", key: "collections" },
  { path: "/about", key: "about" },
  { path: "/contact", key: "contact" },
  { path: "/faq", key: "faq" },
  { path: "/gallery", key: "gallery", noindex: true },
  { path: "/sitemap", key: "sitemap", noindex: true },
  { path: "/legal/privacy", key: "privacy" },
  { path: "/legal/terms", key: "terms" },
  { path: "/legal/cookies", key: "cookie-policy" },
  { path: "/legal/editorial-policy", key: "editorial-policy" },
  { path: "/legal/affiliates", key: "affiliates", noindex: true },
];

const LEGACY_STATIC_REDIRECTS: Record<string, string> = {
  // Series and trips are the same shape of thing — an ordered group of
  // articles — so they share one URL space instead of two.
  "/series": "/collections",
  "/trips": "/collections",
  "/journey": "/collections",
  // Thin noindex pages whose purpose is already served elsewhere. The URLs stay
  // alive; the pages do not.
  "/social": "/contact",
  "/request": "/contact",
  "/roadmap": "/about",
  "/privacy": "/legal/privacy",
  "/terms": "/legal/terms",
  "/cookie-policy": "/legal/cookies",
  "/editorial-policy": "/legal/editorial-policy",
  "/affiliates": "/legal/affiliates",
};

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
    noindex: options.noindex ?? false,
  };
}

/** An old URL that keeps working by pointing at wherever the page lives now. */
function redirect(from: string, to: string): Route {
  return route(from, "redirect", null, {
    isCanonical: false,
    redirectTo: normalizeRoutePath(to) as Route["redirectTo"],
    redirectStatus: 301,
  });
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

  // The archive keeps the legacy key, so `/images/...` still addresses the same
  // bytes after they move into object storage (instruction §60).
  const destination = join(MEDIA_DIR, key);
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
    collected.routes.push(route(`/collections/${series.slug}`, "series", id));
    collected.routes.push(redirect(`/series/${series.slug}`, `/collections/${series.slug}`));
  }

  for (const [index, journey] of legacyJourneys.entries()) {
    const id = stableId("collection", `journey:${journey.id}`) as CollectionId;
    const cover = journey.image ? await registerMedia(ctx, collected, journey.image) : null;
    const { start, end } = journeyDates(journey.date);
    // `j-2024-02-26` says nothing to a reader; the destination and month do.
    const place = slugify(journey.location.split(",")[0] ?? "") || "trip";
    const tripSlug = `${place}-${(start ?? journey.date.replaceAll(".", "-")).slice(0, 7)}`;
    collected.collections.push({
      id,
      slug: tripSlug as Slug,
      kind: "journey",
      title: journey.title,
      description: journey.description,
      coverMediaId: cover?.id ?? null,
      startDate: start,
      endDate: end,
      sortOrder: index,
    });
    collected.routes.push(route(`/collections/${tripSlug}`, "journey", id));
    // Straight to the destination rather than through `/trips/…`: a redirect
    // chain costs a round trip and dilutes the signal.
    collected.routes.push(redirect(`/journey/${journey.id}`, `/collections/${tripSlug}`));
  }

  for (const collection of collected.collections) await ctx.repos.collections.save(collection);

  const allArticleLocations: ArticleLocation[] = [];
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
      kind: "article",
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

    allArticleLocations.push(...articleLocations);

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

  // Location hubs are laid out by ancestry rather than as a flat namespace, and
  // a hub with nothing to list is not generated at all: the old flat URL points
  // at the nearest hub that does have content.
  const tree = new LocationTree(collected.locations, collected.locationNames);
  const articlesPerLocation = new Map<string, number>();
  for (const relation of allArticleLocations) {
    articlesPerLocation.set(
      relation.locationId,
      (articlesPerLocation.get(relation.locationId) ?? 0) + 1,
    );
  }
  const totalFor = (location: Location): number =>
    [location.id, ...tree.descendantIds(location.id)].reduce(
      (sum, id) => sum + (articlesPerLocation.get(id) ?? 0),
      0,
    );

  const canonicalLocationPath = (location: Location): string => {
    const country = tree.countryOf(location.id);
    if (location.type === "continent" || !country) return `/destination/${location.slug}`;
    return location.id === country.id
      ? `/destination/${country.slug}`
      : `/destination/${country.slug}/${location.slug}`;
  };

  const generated = new Map<string, string>();
  for (const location of collected.locations) {
    if (totalFor(location) === 0) continue;
    // Continents sat at the same URL depth as the countries they contain, and
    // `global` is not a place at all; both are dropped in favour of the one
    // level readers actually navigate by.
    if (location.type === "continent" || location.slug === "global") continue;
    const path = canonicalLocationPath(location);
    generated.set(location.id, path);
    // A hub with one or two articles is too thin to index, which is what the
    // legacy site already decided page by page.
    collected.routes.push(
      route(path, "location", location.id, { noindex: totalFor(location) <= 2 }),
    );
  }

  for (const location of collected.locations) {
    const legacyPath = `/destination/${location.slug}`;
    const canonical = generated.get(location.id);
    if (canonical === legacyPath) continue;

    const fallback =
      canonical ??
      // `global` has no geographic parent to fall back to, so it points at the
      // article index rather than at a destination that does not exist.
      (location.slug === "global"
        ? "/posts"
        : (tree
            .ancestors(location.id)
            .toReversed()
            .map((ancestor) => generated.get(ancestor.id))
            .find((path) => path !== undefined) ?? "/destination"));
    collected.routes.push(redirect(legacyPath, fallback));
  }

  // Standalone pages become `page`-kind articles so they gain revisions, SEO
  // handling and the same publishing rules as the rest of the content.
  const pageArticleIds = new Map<string, string>();
  const pageUnknowns: Record<string, string[]> = {};
  for (const page of await readLegacyPages()) {
    const articleId = stableId("article", `page:${page.key}`) as ArticleId;
    const revisionId = stableId("revision", `page:${page.key}:1`) as RevisionId;
    const article: Article = {
      id: articleId,
      kind: "page",
      status: "published",
      locale: "ja",
      slug: page.key as Slug,
      authorId: AUTHOR_ID,
      currentRevisionId: revisionId,
      publishedRevisionId: revisionId,
      createdAt: NOW,
      updatedAt: NOW,
      scheduledAt: null,
      publishedAt: NOW,
      archivedAt: null,
      noindex: false,
      travelStartDate: null,
      travelEndDate: null,
    };
    await ctx.repos.articles.save({
      ...article,
      currentRevisionId: null,
      publishedRevisionId: null,
    });
    await ctx.repos.revisions.save({
      id: revisionId,
      articleId,
      revisionNumber: 1,
      title: page.title,
      summary: page.summary,
      bodyMarkdown: page.bodyMarkdown,
      seoTitleOverride: null,
      seoDescriptionOverride: null,
      changeSummary: "imported from travel-diary",
      createdAt: NOW,
      createdBy: AUTHOR_ID,
    });
    await ctx.repos.articles.save(article);
    pageArticleIds.set(page.key, articleId);
    if (page.unknown.length > 0) pageUnknowns[page.path] = page.unknown;
  }

  for (const page of STATIC_PAGES) {
    collected.routes.push(
      route(page.path, "static", pageArticleIds.get(page.key) ?? page.key, {
        noindex: page.noindex ?? false,
      }),
    );
  }
  for (const [from, to] of Object.entries(LEGACY_STATIC_REDIRECTS)) {
    collected.routes.push(redirect(from, to));
  }

  for (const r of collected.routes) await ctx.repos.routes.save(r);

  // Internal links are pointed at the tidied URLs. The redirects still cover
  // anything that is missed; this only removes a needless hop for readers and
  // crawlers, and never changes the wording around the link.
  const movedPaths = new Map(
    collected.routes
      .filter((r) => r.targetType === "redirect" && r.redirectTo !== null)
      .map((r) => [r.path as string, r.redirectTo as string]),
  );
  let rewritten = 0;
  for (const article of await ctx.repos.articles.listAll()) {
    const revisionId = article.publishedRevisionId;
    if (!revisionId) continue;
    const revision = await ctx.repos.revisions.findById(revisionId);
    if (!revision) continue;

    const body = revision.bodyMarkdown.replace(
      /\]\((\/[^)\s#]*)((?:#[^)\s]*)?)\)/g,
      (match, path: string, fragment: string) => {
        const destination = movedPaths.get(normalizeRoutePath(path));
        return destination === undefined ? match : `](${destination}${fragment})`;
      },
    );
    if (body === revision.bodyMarkdown) continue;
    await ctx.repos.revisions.save({ ...revision, bodyMarkdown: body });
    rewritten++;
  }

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
        bodiesWithRewrittenLinks: rewritten,
        // Carried forward so the rewrite cannot silently start indexing a page
        // the legacy site kept out of the index.
        legacyNoindexStatic: STATIC_PAGES.filter((p) => p.noindex).map((p) => p.path),
        // Dynamic fragments of the legacy pages that a template now renders
        // instead; listed so nothing is assumed to have been carried over.
        pagesNeedingReview: pageUnknowns,
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
