import type { ArticleId, Route } from "@tomokichi/domain";
import type { Breadcrumb } from "@tomokichi/seo";
import { content } from "./content";

const HOME: Breadcrumb = {
  name: "ホーム",
  route: { path: "/" } as Route,
};

function crumb(path: string, name: string): Breadcrumb {
  return { name, route: (content.routes.find(path) ?? ({ path } as Route)) as Route };
}

/**
 * Breadcrumbs follow the entity graph rather than the URL string, so a page
 * reached through a redirect still shows where it actually belongs.
 */
export function articleTrail(articleId: ArticleId, route: Route): Breadcrumb[] {
  const trail = [HOME, crumb("/posts", "記事")];

  const location = content.primaryLocationOf(articleId);
  if (location) {
    for (const ancestor of [...content.locations.ancestors(location.id), location]) {
      const hub = content.routes.canonicalFor("location", ancestor.id);
      if (hub) trail.push({ name: content.locations.nameOf(ancestor.id, "ja"), route: hub });
    }
  }

  trail.push({ name: content.titleOf(articleId), route });
  return trail;
}

export function locationTrail(route: Route): Breadcrumb[] {
  const location = content.locations.get((route.targetId ?? "") as never);
  const trail = [HOME, crumb("/destination", "旅先")];
  if (!location) return trail;

  for (const ancestor of [...content.locations.ancestors(location.id), location]) {
    const hub = content.routes.canonicalFor("location", ancestor.id);
    if (hub) trail.push({ name: content.locations.nameOf(ancestor.id, "ja"), route: hub });
  }
  return trail;
}

export function collectionTrail(route: Route, title: string): Breadcrumb[] {
  return [HOME, crumb("/collections", "コレクション"), { name: title, route }];
}

export function pageTrail(route: Route, title: string): Breadcrumb[] {
  const trail = [HOME];
  if (route.path.startsWith("/legal/")) trail.push(crumb("/legal/privacy", "サイトポリシー"));
  trail.push({ name: title, route });
  return trail;
}
