declare const brand: unique symbol;

/** Nominal typing helper: `Brand<string, "ArticleId">` is not assignable from a bare string. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
