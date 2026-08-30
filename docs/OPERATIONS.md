# Operations

Every failure the system reports carries a stable code. Look the code up here;
the wording of messages may change, the codes do not.

Start with `.artifacts/ci/summary.json`. Read a full log only when the summary
does not explain the failure.

```bash
pnpm diagnostics
```

## Pipeline

### `FORMAT_CHECK_FAILED`

Formatting drift. `pnpm format`, then commit.

### `LINT_FAILED` / `TYPECHECK_FAILED`

`pnpm lint` / `pnpm typecheck`. The finding names the file and line.

### `BOUNDARY_VIOLATION`

Something in `packages/` or `infrastructure/` imported a framework or a package
it may not depend on. Move the code to the layer that is allowed to know about
it, or invert it behind a port in `packages/application/src/ports`.

Rules live in `scripts/check-boundaries.ts`.

### `TEST_FAILED` / `BUILD_FAILED`

`pnpm test` / `pnpm build`.

## Routes

### `ROUTE_LEGACY_MISSING`

A URL the previous site published no longer resolves. This is the most serious
failure in the system: it loses traffic and rankings.

- Check `migration/legacy-routes.json` for the URL.
- If the page moved on purpose, add a redirect route rather than deleting the
  old one: `POST /admin/routes/move`, or add it in the importer.
- Re-run: `pnpm check:routes`.

### `ROUTE_DUPLICATE_PATH` / `ROUTE_TARGET_MISSING` / `ROUTE_REDIRECT_LOOP`

Structural problems in the route table. `ROUTE_TARGET_MISSING` on a path that
exists usually means the page was not generated — check that
`apps/web/src/pages/[...route].astro` handles that `targetType`.

## SEO

### `SEO_CANONICAL_MISSING` / `SEO_CANONICAL_MISMATCH`

The page has no canonical, or it disagrees with the route table. Canonicals are
built from routes in `packages/seo/src/metadata.ts` — a mismatch means the page
was rendered outside the route-driven path.

### `SEO_NOINDEX_REGRESSION`

A page the previous site allowed into the index is now noindex. Either the
route carries `noindex`, the article does, or `PUBLIC_INDEXABLE=false` leaked
into a production build.

### `SEO_SITEMAP_MISMATCH`

A URL is in the sitemap but is not indexable. Search Console reports this as an
error. The sitemap is generated in `apps/web/src/pages/sitemap.xml.ts`.

### `SEO_TITLE_MISSING` / `SEO_DESCRIPTION_MISSING` / `SEO_H1_MISSING` / `SEO_H1_DUPLICATE`

Usually a template change. Titles and descriptions fall back to the revision's
own title and summary, so an empty summary on a new article shows up here.

### `SEO_IMAGE_ALT_MISSING`

Alt text lives on the article/media relation, not on the asset. Fix it in the
admin's 画像 panel.

## Links

### `LINK_INTERNAL_BROKEN`

An internal link or image in the generated site points at something that was not
built. Run `pnpm check:links`; the target reads `<page> → <link>`.

Two legacy articles reference hero images that are 404 on the old site as well
(`/images/Singapore/jewel-rain-vortex.jpg`,
`/images/Singapore/seletar-airport-arrival.jpg`) — those need new images, not a
code fix.

## Performance

### `PERF_SCORE` / `PERF_LCP` / `PERF_CLS` / `PERF_TBT`

The budget is Performance ≥ 95, SEO = 100, LCP ≤ 2.5s, CLS ≤ 0.10, TBT ≤ 200ms.

- Check the hero image on the named route: is `width`/`height` set, and is the
  first card `fetchpriority="high"`?
- The public site ships no JavaScript. A non-zero TBT means an island was added.
- Re-run one page: `pnpm perf` (edit `lighthouserc.json` to narrow the URL list).

### `PERF_REGRESSION`

Slower than the baseline even though still inside budget. Set `PERF_BASELINE` to
a `perf-baseline.json` from a green run on `main`.

## Data

### `DB_MIGRATION_FAILED`

Migrations are append-only. Never edit an applied file; add
`migrations/000N_description.sql`. `pnpm test` applies every migration to an
empty database on each run.

### `EXPORT_FAILED` / `IMPORT_FAILED`

`pnpm export:data` reads the local SQLite database at `.data/tomokichi.db`.
If it is missing, re-run `pnpm import:legacy` or restore from `export/`.

## Media

Images are served from R2, not from the site Worker. `pnpm media:build`
generates the responsive ladder into `.cache/images`; `pnpm media:sync` uploads
originals and derivatives, skipping anything already sent.

If an image 404s on the site, check in order: the file exists under `media/`,
`pnpm media:build` produced its derivatives, and `pnpm media:sync` reported no
failures. `LINK_INTERNAL_BROKEN` catches all three before a deploy.

## API

### `API_UNAUTHORIZED`

`ADMIN_TOKEN` is unset on the Worker, or the admin is sending a stale token.
`wrangler secret put ADMIN_TOKEN`. A missing secret closes the admin API — it
never opens it.

### `API_VALIDATION_FAILED`

The response lists `issues` with a path per field.

### `ARTICLE_NOT_PUBLISHABLE`

`GET /admin/articles/:id/publish-check` returns every reason at once: title,
summary, body length, a canonical route, and a cover image with alt text.
