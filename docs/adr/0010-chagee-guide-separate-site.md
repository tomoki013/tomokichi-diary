# The CHAGEE guide is a separate site in this repository

## Context

The owner wanted an unofficial Japanese CHAGEE guide at `chagee.tomokichidiary.com`: menus, ordering, stores and news on the guide, while travel reports stay on the blog. It should live next to the blog if possible, with neither side able to see the other.

## Decision

`apps/chagee` is an Astro app rendered per request on its own Worker (`chagee-guide`) with its own D1 database (`chagee-guide`) and R2 bucket (`chagee-guide-media`). It imports nothing from `@tomokichi/*` and binds nothing of the blog's. Content is committed as `apps/chagee/content/*.json` and upserted into D1 by `pnpm --filter @tomokichi/chagee db:seed`. Columns are links to blog posts, never copies.

## Why

Same repository keeps one toolchain and CI; separate bindings keep the data apart, so a guide bug can't touch blog data and the blog's static-export rule (ADR 0006) doesn't bind the guide. Rendering from D1 lets news go live without a rebuild.

## Consequences

The guide does not follow ADR 0006: its pages need D1 at request time. The blog's checks (`check:routes`, `check:seo`, Lighthouse) don't cover it. A contact form needs the guide registered on the inquiry platform as `chagee-guide`.
