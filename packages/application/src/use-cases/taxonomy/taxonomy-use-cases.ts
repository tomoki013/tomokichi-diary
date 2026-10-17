import {
  COLLECTION_KINDS,
  err,
  ok,
  parseRoutePath,
  parseSlug,
  type Collection,
  type CollectionId,
  type CollectionKind,
  type MediaId,
  type Result,
  type Route,
  type RouteId,
  type Tag,
  type TagId,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 400;

function requireText(value: string, field: string, max: number): Result<string> {
  const text = value.trim();
  if (text === "")
    return err({ code: "API_VALIDATION_FAILED", message: `${field} must not be empty`, field });
  if (text.length > max)
    return err({
      code: "API_VALIDATION_FAILED",
      message: `${field} must be at most ${max} characters`,
      field,
    });
  return ok(text);
}

export interface CreateTagInput {
  readonly slug: string;
  readonly name: string;
}

/** Tags have no page of their own, so a tag is only its slug and label. */
export async function createTag(ctx: AppContext, input: CreateTagInput): Promise<Result<Tag>> {
  const slug = parseSlug(input.slug);
  if (!slug.ok) return err(...slug.errors);
  const name = requireText(input.name, "name", MAX_NAME);
  if (!name.ok) return err(...name.errors);

  const existing = await ctx.repos.taxonomy.listTags();
  if (existing.some((tag) => tag.slug === slug.value))
    return err({
      code: "API_CONFLICT",
      message: `slug already in use: ${slug.value}`,
      field: "slug",
    });
  if (existing.some((tag) => tag.name === name.value))
    return err({
      code: "API_CONFLICT",
      message: `name already in use: ${name.value}`,
      field: "name",
    });

  const tag: Tag = { id: ctx.ids.next<TagId>(), slug: slug.value, name: name.value };
  await ctx.repos.taxonomy.saveTag(tag);
  ctx.logger.info("tag.created", { tagId: tag.id, slug: tag.slug });
  return ok(tag);
}

export interface CreateCollectionInput {
  readonly kind: string;
  readonly slug: string;
  readonly title: string;
  readonly description?: string | null;
  readonly coverMediaId?: string | null;
  readonly sortOrder?: number | null;
}

export interface UpdateCollectionInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly coverMediaId?: string | null;
  readonly sortOrder?: number;
}

function parseDescription(value: string | null | undefined): Result<string | null> {
  const text = value?.trim() ?? "";
  if (text === "") return ok(null);
  if (text.length > MAX_DESCRIPTION)
    return err({
      code: "API_VALIDATION_FAILED",
      message: `description must be at most ${MAX_DESCRIPTION} characters`,
      field: "description",
    });
  return ok(text);
}

function parseSortOrder(value: number): Result<number> {
  return Number.isInteger(value) && value >= 0 && value <= 100000
    ? ok(value)
    : err({
        code: "API_VALIDATION_FAILED",
        message: "sortOrder must be an integer between 0 and 100000",
        field: "sortOrder",
      });
}

/** A cover must be a photo that exists; an unknown id is rejected, not stored. */
async function parseCover(
  ctx: AppContext,
  value: string | null | undefined,
): Promise<Result<MediaId | null>> {
  if (value === undefined || value === null || value === "") return ok(null);
  const asset = await ctx.repos.media.findById(value as MediaId);
  if (!asset || !asset.mimeType.startsWith("image/"))
    return err({
      code: "API_VALIDATION_FAILED",
      message: `no image ${value}`,
      field: "coverMediaId",
    });
  return ok(asset.id);
}

/**
 * A series or journey, with its canonical page at `/collections/<slug>` —
 * the shape every existing collection has. The page is built on the next
 * publication.
 */
export async function createCollection(
  ctx: AppContext,
  input: CreateCollectionInput,
): Promise<Result<{ collection: Collection; route: Route }>> {
  if (!(COLLECTION_KINDS as readonly string[]).includes(input.kind))
    return err({
      code: "API_VALIDATION_FAILED",
      message: `kind must be one of ${COLLECTION_KINDS.join(", ")}`,
      field: "kind",
    });
  const slug = parseSlug(input.slug);
  if (!slug.ok) return err(...slug.errors);
  const title = requireText(input.title, "title", MAX_NAME);
  if (!title.ok) return err(...title.errors);
  const description = parseDescription(input.description);
  if (!description.ok) return err(...description.errors);
  const cover = await parseCover(ctx, input.coverMediaId);
  if (!cover.ok) return err(...cover.errors);
  const sortOrder =
    input.sortOrder === undefined || input.sortOrder === null
      ? null
      : parseSortOrder(input.sortOrder);
  if (sortOrder && !sortOrder.ok) return err(...sortOrder.errors);

  const path = parseRoutePath(`/collections/${slug.value}`);
  if (!path.ok) return err(...path.errors);

  const collections = await ctx.repos.collections.listAll();
  if (collections.some((collection) => collection.slug === slug.value))
    return err({
      code: "API_CONFLICT",
      message: `slug already in use: ${slug.value}`,
      field: "slug",
    });
  if (await ctx.repos.routes.findByPath(path.value))
    return err({
      code: "API_CONFLICT",
      message: `path already in use: ${path.value}`,
      field: "slug",
    });

  const kind = input.kind as CollectionKind;
  const collection: Collection = {
    id: ctx.ids.next<CollectionId>(),
    slug: slug.value,
    kind,
    title: title.value,
    description: description.value,
    coverMediaId: cover.value,
    startDate: null,
    endDate: null,
    sortOrder:
      sortOrder?.value ?? collections.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10,
  };
  const route: Route = {
    id: ctx.ids.next<RouteId>(),
    path: path.value,
    locale: "ja",
    targetType: kind,
    targetId: collection.id,
    isCanonical: true,
    redirectTo: null,
    redirectStatus: null,
    isLegacy: false,
    noindex: false,
  };
  await ctx.repos.collections.save(collection);
  await ctx.repos.routes.save(route);
  ctx.logger.info("collection.created", { collectionId: collection.id, route: route.path });
  return ok({ collection, route });
}

/**
 * Title, description, cover and order. The slug and the URL are fixed once a
 * collection exists: changing them would break links (moving a URL is the
 * route tool's job, with a redirect). Collections are never deleted here.
 */
export async function updateCollection(
  ctx: AppContext,
  id: CollectionId,
  input: UpdateCollectionInput,
): Promise<Result<Collection>> {
  const current = await ctx.repos.collections.findById(id);
  if (!current) return err({ code: "COLLECTION_NOT_FOUND", message: `no collection ${id}` });

  let next: Collection = current;
  if (input.title !== undefined) {
    const title = requireText(input.title, "title", MAX_NAME);
    if (!title.ok) return err(...title.errors);
    next = { ...next, title: title.value };
  }
  if (input.description !== undefined) {
    const description = parseDescription(input.description);
    if (!description.ok) return err(...description.errors);
    next = { ...next, description: description.value };
  }
  if (input.coverMediaId !== undefined) {
    const cover = await parseCover(ctx, input.coverMediaId);
    if (!cover.ok) return err(...cover.errors);
    next = { ...next, coverMediaId: cover.value };
  }
  if (input.sortOrder !== undefined) {
    const sortOrder = parseSortOrder(input.sortOrder);
    if (!sortOrder.ok) return err(...sortOrder.errors);
    next = { ...next, sortOrder: sortOrder.value };
  }
  await ctx.repos.collections.save(next);
  ctx.logger.info("collection.updated", { collectionId: id });
  return ok(next);
}
