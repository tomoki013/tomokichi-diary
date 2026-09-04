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

### `KNOWLEDGE_VALIDATION_FAILED`

The travel-knowledge graph violates an evidence invariant or has a broken stable-ID
reference. Run `pnpm check:knowledge`; fix the named fact or article knowledge record.
Never bypass a missing `verifiedBy` on firsthand data—send the candidate through the
human verification command instead.

`pnpm knowledge:backlog` regenerates the list of published articles that still need
manual evidence review. A backlog item is not public structured knowledge.

## Public MCP

`apps/mcp-server` serves a stateless, read-only Streamable HTTP endpoint at `/mcp`
and a liveness response at `/health`. It bundles the committed knowledge catalog, so
it does not require D1 or an AI provider at runtime. Rebuild the catalog after content
exports and deploy with `pnpm deploy:mcp`. MCP Apps-capable hosts render the evidence
view; all other clients receive the same facts as text and structured content.

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
- The public site ships only small progressive scripts (including WebMCP). A TBT
  regression means one of those scripts or an island needs inspection.
- Re-run one page: `pnpm perf` (edit `lighthouserc.json` to narrow the URL list).

### `PERF_REGRESSION`

Slower than the baseline even though still inside budget. Set `PERF_BASELINE` to
a `perf-baseline.json` from a green run on `main`.

## Data

### `DB_MIGRATION_FAILED`

Migrations are append-only. Never edit an applied file; add
`migrations/000N_description.sql`. `pnpm test` applies every migration to an
empty database on each run.

**Migrations must be expand/contract.** Deployment applies them before the API
that reads the new shape is deployed, so there is always a window where the old
API runs against the new database. A migration that the old API cannot survive
takes the site down for the length of that window.

In practice, one schema change is two releases:

1. _Expand_ — add the new column/table, nullable or defaulted, and backfill.
   The old API ignores it; the new API writes to both shapes.
2. _Contract_ — once the new API is live, a later migration drops the old
   column/table.

So: never rename, drop, or narrow (`NOT NULL`, tightened `CHECK`) a column that
the currently deployed API still reads or writes. Add, backfill, deploy, and
only then remove.

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

### Contact form

The form posts to the versioned `POST /v1/contact` API, which verifies a Turnstile token,
rate-limits the sender and stores the message in D1. Submissions are read in
the admin under お問い合わせ; nothing is emailed and no third party sees them.

Three secrets gate it, and a missing one closes the form rather than opening it:

| Secret                 | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `TURNSTILE_SECRET_KEY` | Verifies the challenge token                 |
| `IP_HASH_SALT`         | Salts the sender hash used for rate limiting |
| `ADMIN_TOKEN`          | Guards reading the messages                  |

The public site needs `PUBLIC_TURNSTILE_SITE_KEY` at build time; without it the
form is not rendered at all.

Set `TURNSTILE_EXPECTED_HOSTNAME=tomokichidiary.com,www.tomokichidiary.com` in
production so a valid token is also checked against an expected hostname and
the `contact` widget action.

A submission is stored with status `spam` when it trips the heuristic (link
floods, bbcode or HTML link markup). It is flagged rather than dropped, so a
false positive is still readable.

### `API_UNAUTHORIZED`

Admin access is granted two ways, and either is enough:

1. **Cloudflare Access** — a valid `Cf-Access-Jwt-Assertion` on the request,
   verified against the team's public keys. Requires `ACCESS_TEAM_DOMAIN` and
   `ACCESS_AUD` to be set as vars.
2. **Bearer token** — `ADMIN_TOKEN`, compared in constant time.

Configuring Access does not disable the token. Delete `ADMIN_TOKEN`
(`wrangler secret delete ADMIN_TOKEN`) to make Access the only way in.

A missing secret closes the admin API — it never opens it.

The admin is served from `admin.tomokichidiary.com`, which also carries the API
under `/api/*` through a service binding. That is what makes the browser's
calls same-origin, so one Access application covers the UI and the API it talks
to. Neither Worker has a workers.dev URL, because that would sit outside Access
and outside the custom domain.

`api.tomokichidiary.com` stays public: it serves the contact form, whose whole
purpose is to accept requests from people who are not signed in.

### `API_VALIDATION_FAILED`

The response lists `issues` with a path per field.

### `ARTICLE_NOT_PUBLISHABLE`

`GET /admin/articles/:id/publish-check` returns every reason at once: title,
summary, body length, a canonical route, and a cover image with alt text.
