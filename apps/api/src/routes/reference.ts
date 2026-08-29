import { Hono } from "hono";
import type { TaxonomyDto } from "@tomokichi/contracts";
import type { AppEnv } from "../app.js";
import { toLocationDto } from "../mappers.js";

/** Read-only lists the admin needs to fill in relation pickers. */
export function referenceRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/locations", async (c) => {
    const ctx = c.get("ctx");
    const [locations, names] = await Promise.all([
      ctx.repos.locations.listAll(),
      ctx.repos.locations.listNames(),
    ]);
    return c.json({ items: locations.map((location) => toLocationDto(location, names)) });
  });

  routes.get("/places", async (c) => {
    const places = await c.get("ctx").repos.places.listAll();
    return c.json({
      items: places.map((place) => ({
        id: place.id,
        slug: place.slug,
        name: place.name,
        kind: place.kind,
        locationId: place.locationId,
      })),
    });
  });

  routes.get("/taxonomy", async (c) => {
    const ctx = c.get("ctx");
    const [categories, tags, collections] = await Promise.all([
      ctx.repos.taxonomy.listCategories(),
      ctx.repos.taxonomy.listTags(),
      ctx.repos.collections.listAll(),
    ]);
    const body: TaxonomyDto = {
      categories: categories.map((category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
      })),
      tags: tags.map((tag) => ({ id: tag.id, slug: tag.slug, name: tag.name })),
      collections: collections.map((collection) => ({
        id: collection.id,
        slug: collection.slug,
        kind: collection.kind,
        title: collection.title,
      })),
    };
    return c.json(body);
  });

  return routes;
}
