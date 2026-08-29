import type { CategoryId, TagId } from "../primitives/id.js";
import type { Slug } from "../primitives/slug.js";

/** Few, curated, part of the information architecture. */
export interface Category {
  readonly id: CategoryId;
  readonly slug: Slug;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
}

/** Many, free-form, describes content rather than structure. */
export interface Tag {
  readonly id: TagId;
  readonly slug: Slug;
  readonly name: string;
}
