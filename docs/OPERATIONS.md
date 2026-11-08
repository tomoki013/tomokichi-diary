# Operations

Every failure the system reports carries a stable code. Look the code up here;
the wording of messages may change, the codes do not.

Start with `.artifacts/ci/summary.json`. Read a full log only when the summary
does not explain the failure.

```bash
pnpm diagnostics
```

## Releasing

Content publishing now uses D1 as the source of truth. Both code releases and the `Publish content` workflow pull its published versions before building. Admin setup, publication status, retries and schedules are documented in [ADMIN.md](ADMIN.md). The committed export remains the offline recovery and code CI snapshot.

A push to `main` deploys itself: the `Deploy` job in `.github/workflows/ci.yml`
starts only after the `Check` job is green and runs the sequence below. Its
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are secrets of the GitHub
`production` environment (never repository secrets, so pull request runs cannot
read them), attached only to the steps that talk to Cloudflare.

- To reload `export/` into D1 as part of a release (after a batch edit made
  through the local tooling, such as `pnpm content:experiences`), run the
  workflow by hand on `main` with **seed** ticked.
- Until the cutover the site is verified on workers.dev; set the environment
  variable `VERIFY_URL` to `https://tomokichidiary.com` once the domain points
  at the Worker. The production build must also carry
  `PUBLIC_INDEXABLE=true`; all other builds are noindex by default.
- Media sync always lists the **current R2 origin** and compares object key, size,
  ETag (byte digest) and Cache-Control. `.cache/r2-manifest.json` is diagnostic
  only; losing it does not resend the bucket. Missing objects are repaired even
  when an old manifest claims they exist. API/list failures stop publication.
- The derivative/original Actions cache uses the encoder/toolchain and a unique
  run/attempt key. Every build saves the expanded cache; no Git `export/media.json`
  value is used as the production snapshot identity. Missing local derivatives
  are restored from R2 and checked before encoding. Widths, AVIF/WebP quality,
  existing object URLs and cache lifetimes are preserved.
- For recovery, dispatch **Publish content** on `main` with **full_media** checked
  to regenerate and resync all required images. `CI` still accepts
  **full_media_sync** to resend objects. For a complete local rebuild, set
  `MEDIA_BUILD_FULL=1` and `MEDIA_SYNC_FULL=1`. Normal cache loss needs no manual
  action. No recovery command deletes objects or unpublishes articles.

Article publication builds only Astro, plus MCP when its embedded catalog or
code/dependency/configuration inputs differ from the last successful MCP deployment.
MCP deploy reuses its UI bundle; API, admin and CHAGEE builds are reserved for code CI.
The existing route, SEO, link and Knowledge validators remain gates; publication
also checks WebMCP surfaces. Read-only validators run concurrently against the same
immutable generated site. Code CI still runs all existing checks and application builds.

Use the GitHub workflows for production release: both hold the shared `deploy`
concurrency lock, pull published D1 data, sync/verify R2, deploy, then confirm a
unique `/__publication/<build-id>.json` marker from the public Worker **before**
recording success. The marker identifies request, execution and snapshot, has
no article content, and is served with no-store/noindex. A stale/missing marker
causes failure and retry rather than a false completion. Do not run deployments
from an unlocked local shell while Actions is publishing.

Publication credentials stay in the production environment. The step wrapper
removes Cloudflare/GitHub tokens from local build/validation child processes;
package installation receives no Cloudflare credentials. The existing token must
allow R2 object listing/reading as well as writes. The final timings collector
uses Actions read permission and a short-lived GitHub token, never the admin token.

See [publication-pipeline.md](publication-pipeline.md) for migration order,
request/execution fencing, recovery, measured results and remaining production checks.

### Domain cutover preflight

`verify:live` checks legacy URL coverage, but it cannot detect a wrong
canonical host, a preview accidentally becoming indexable, a missing `www` or
HTTP redirect, or a site/API CORS mismatch. After the web Worker and DNS are
ready, run both checks against the real domain:

```bash
pnpm verify:live https://tomokichidiary.com
pnpm verify:cutover https://tomokichidiary.com
```

`verify:cutover` is intentionally strict. It checks the home page canonical,
robots.txt, sitemap host consistency, apex HTTPS, `www` and HTTP redirects,
the service worker, a representative media asset, and the API health/CORS
origin. Do not proceed to Search Console resubmission or announce the cutover
while it is failing.

Before changing DNS:

- keep the current Netlify domain attached for the rollback window;
- lower DNS TTL ahead of the change and switch apex and `www` together;
- confirm the Cloudflare custom domain/redirect rules are ready, because the
  web Worker's `cloudflare.config.ts` deliberately does not contain a guessed zone
  ID or an automatic domain binding;
- deploy API and web in the documented order, then point `VERIFY_URL` at the
  custom domain;
- check the production contact form, API health, media URL, GSC URL
  inspection, and GA4 realtime after the two automated checks pass.

If any check fails, leave DNS on Netlify. The existing workers.dev deployment
and Netlify site remain the safe rollback paths.

Two details that are easy to lose:

- The artefacts that ship must be built with the production `PUBLIC_SITE_URL`
  and `PUBLIC_INDEXABLE`. A build made with the defaults carries the wrong
  canonical URLs and a `noindex`.
- The admin SPA is built against the deployed API (`VITE_API_URL`), so it is
  built after the API is live, not before.

`db:migrate` runs ahead of the API that reads the new shape, which is why every
migration has to be expand/contract — see
[`DB_MIGRATION_FAILED`](#db_migration_failed).

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
`pnpm check:agents` verifies the built WebMCP contexts, tools, JSON projections and
single-file MCP App. After deployment, run
`pnpm verify:mcp https://mcp.tomokichidiary.com` to exercise
protocol negotiation, tools, firsthand filtering and the UI resource against production.

The MCP Worker keeps its `workers.dev` host live during migration. The OAuth issuer,
resource and KV prefixes are separate for the new custom domain; clients must reauthorize
at `https://mcp.tomokichidiary.com`. Configure a dedicated Cloudflare Access application
for exactly `/analytics-connect` and `/operator-connect`, then set its Audience Tag as
`MCP_CONSENT_ACCESS_AUD` in the GitHub Actions `production` environment and pass it
to manual API deploys. Leave MCP, OAuth, and discovery endpoints outside Access so
token-based clients can reach them. Follow the [first rollout order](OPERATOR_MCP.md#cloudflare-設定と移行)
for the D1 migration and the two new Service Binding entrypoints.
The owner can search `/activity` and revoke individual
OAuth grants from `/mcp-connections`; the existing owner-subject secret remains the
emergency stop for all Operator connections.

### `AGENT_SURFACE_FAILED`

An article knowledge record was built without its WebMCP context/tool registrations,
its machine-readable JSON endpoint, or the MCP App bundle. Run `pnpm build` and then
`pnpm check:agents`; fix the named generated surface rather than suppressing the check.

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
route carries `noindex`, the article does, or a build meant for production
came out without `PUBLIC_INDEXABLE=true` (every page noindex).

The comparison is skipped for preview builds: when `dist/robots.txt` is
`Disallow: /` and `PUBLIC_INDEXABLE` is not `true`, the success line ends with
`index off (preview build, regression check skipped)`. A plain local
`pnpm build` is such a build. To check indexing locally, build and check with
`PUBLIC_INDEXABLE=true`.

### `SEO_SITEMAP_MISMATCH`

A URL is in the sitemap but is not indexable. Search Console reports this as an
error. The sitemap is generated in `apps/web/src/pages/sitemap.xml.ts`.

### `SEO_TITLE_MISSING` / `SEO_DESCRIPTION_MISSING` / `SEO_H1_MISSING` / `SEO_H1_DUPLICATE`

Usually a template change. Titles and descriptions fall back to the revision's
own title and summary, so an empty summary on a new article shows up here.

### `SEO_IMAGE_ALT_MISSING`

Alt text lives on the article/media relation, not on the asset. Fix it in the
admin's 画像 panel.

### `SEO_IMAGE_URL_INVALID`

An `og:image`, `twitter:image` or JSON-LD `image` on the built page is not a
single absolute `http(s)` image URL. The finding names the URL. The case this
was written for is a media URL that was made absolute twice —
`https://tomokichidiary.com/https://media.tomokichidiary.com/…` — which every
crawler accepts as a URL and no share card can load. `mediaUrl()` already
returns an absolute URL; never pass its result through `absoluteUrl()`. The
rule itself is `imageUrlProblem` in `scripts/lib/page-seo.ts`.

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

The budget is Performance ≥ 95, SEO = 100, LCP ≤ 2.5s, CLS ≤ 0.10, TBT ≤ 200ms,
judged on the **median** of each page's runs (`numberOfRuns` in
`lighthouserc.json`), not on the worst one: a single run's TBT swings widely
depending on whether first paint lands before the initial style-and-layout task.

- Check the hero image on the named route: is `width`/`height` set, and is the
  first card `fetchpriority="high"`?
- The public site ships only small progressive scripts (including WebMCP). A TBT
  regression means one of those scripts or an island needs inspection — or a
  page laying out too much up front: long listings and below-the-fold bands use
  `content-visibility: auto` so they are skipped until scrolled near.
- Re-run one page: `pnpm perf` (edit `lighthouserc.json` to narrow the URL list).
- Known structural costs and planned work are listed in
  [audit §11.3](audit/diary-2.0-full-audit.md#113-20-で残る改善点) (P-6 onwards).

### `PERF_REGRESSION`

Slower than the baseline even though still inside budget. Set `PERF_BASELINE` to
a `perf-baseline.json` from a green run on `main`.

## Data

### `DB_MIGRATION_FAILED`

Migrations are append-only. Never edit an applied file; add
`migrations/000N_description.sql`. `pnpm test` applies every migration to an
empty database on each run.

**Migrations must be expand/contract.** A release applies them before the API
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
If it is missing or older than the committed export, `pnpm db:restore-local`
rebuilds it from `export/` (the previous file is kept beside it as `.bak`).

### Editing content without the admin

`pnpm content:revise <file.md>` publishes a new revision of an existing
article through the same use cases the admin API calls, against the local
database. The file's frontmatter names the `slug`, optional `title`,
`summary`, `seoDescription`, a required `changeSummary` and an optional
`updatedAt` (`keep` for a metadata-only change); the body replaces the article
body when present. `publishedAt` is never touched. Travel knowledge attached
to the previous revision is carried over. Always:

```bash
pnpm db:restore-local
pnpm content:revise path/to/revision.md
pnpm export:data && pnpm legacy:export   # legacy:export until the cutover
```

then commit `export/` (and the legacy repository) and release as usual
(`pnpm db:seed` puts the new revision into D1).

`db:seed` upserts on each table's primary key (`scripts/lib/seed-sql.ts`), so
it is safe to rerun against production: rows the export does not carry --
reader likes, contact messages, admin drafts -- are left alone. It must never
go back to `INSERT OR REPLACE`: REPLACE deletes before inserting, and the
`ON DELETE CASCADE` on `article_likes` and the revision tables turns that into
a wipe (`scripts/lib/__tests__/seed-sql.test.ts` fails if it does).

### `CONTENT_PARITY_MISMATCH` (temporary, until the cutover)

The previous Next.js site (`../travel-diary`, or `LEGACY_REPO`) serves an
article that differs from `export/` — a different title, description, body,
heading, image, link, date, or an article missing on one side.
`pnpm content:parity --report` lists every field in
`docs/migration/content-parity-report.md`.

Diary 2.0 is canonical, so the fix depends on which side moved:

- **2.0 changed** (the usual case): `pnpm legacy:export`, then commit and push
  the legacy repository. CI on this repository checks out the legacy `main`,
  so push the legacy repository first or the check stays red.
- **The legacy repository was edited directly**: do not copy the text back by
  hand. Fold the change into 2.0 with `pnpm content:revise` (or the admin),
  `pnpm export:data`, then `pnpm legacy:export`.
- **The legacy checkout is missing**: the step is skipped, not failed.

The whole mechanism is deleted after the cutover — see
`scripts/legacy-sync/README.md` and `docs/migration/legacy-content-sync.md`.

## Media

Images are served from R2, not from the site Worker. `pnpm media:build`
generates the responsive ladder into `.cache/images`; `pnpm media:sync` uploads
originals and derivatives, skipping anything already sent.

If an image 404s on the site, check in order: the file exists under `media/`,
`pnpm media:build` produced its derivatives, and `pnpm media:sync` reported no
failures. `LINK_INTERNAL_BROKEN` catches all three before a deploy.

## Browser

### Service worker

`apps/web/public/sw.js` is hand-written and deliberately small: pages are
network-first (the cached copy is only read offline, so a republish is visible
immediately), `/_astro/*` is cache-first because it is immutable, and media and
everything else are left to the browser. Install fetches only `/offline` and
its stylesheet. Caches are bounded (40 pages, 60 assets).

To change caching behaviour, bump `VERSION` in `sw.js`: activate deletes every
cache that is not the current version's. To take the worker out entirely,
replace `sw.js` with a worker that unregisters itself -- never delete the file,
a 404 leaves the old worker running for returning visitors.

### Analytics and ads

GA4 (`G-BZJ1EDMYTZ`, the previous site's property) loads only on
`tomokichidiary.com` / `www.`, after `load` and on idle, so previews, local
builds and Lighthouse never report into it or pay for it. Semantic events go
through `trackSemanticEvent` (`apps/web/src/lib/analytics.ts`) as
`gtag("event", …)`.

AdSense: `public/ads.txt` and the `google-adsense-account` meta are shipped.
The sole display unit `7152502134` is fixed at 300×250, after article text,
thanks and share controls. Home, indexes, galleries and legal/contact pages
have no ad slots. `ArticleAd.astro` reserves the space before rendering;
`lib/ads.ts` requests the script only on the production apex/www, after page
load and when the slot is within 200px of the viewport. Narrow containers
under 300px do not request an ad. Previews/local builds never contact AdSense.
Blocked or failed scripts do not retry or collapse the reserved space.

2026-10-13: Diary's AdSense Auto ads and Auto optimize were both switched off
with the user's UX-first authorization; the manual unit was created in the
existing account. Keep Auto ads/Auto optimize off: turning them on can insert
additional ads independently of this template. No anchor/vignette/side-rail,
offerwall or ad-block recovery prompt is used. The existing published Google
CMP European message for this site includes consent, refusal and management
choices. The ad privacy link uses Google's revocation flow when available and
otherwise opens the cookie policy. Other sites' messages/settings are unchanged.
AdSense report OAuth is a separate integration and is still disabled.

To stop ads, remove `<ArticleAd />` from `ArticlePage.astro` and release through
the usual CI path; ads.txt and the verification meta may remain. Do not add
slots or enable automatic optimization based on revenue alone.

## API

### Contact form

The form posts to the versioned `POST /v1/contact` API, which checks the
honeypot, verifies a Turnstile token, validates the fields, rate-limits the
sender (one per minute per salted IP hash, `CONTACT_RATE_LIMITER`), then:

1. **Files the message on the shared inquiry platform**
   ([tomoki013/inquiry-platform](https://github.com/tomoki013/inquiry-platform),
   SDK pinned in `apps/api/package.json`), where it becomes a ticket that is
   worked and answered from the admin's お問い合わせ screen.
2. **Tells `tomokichidiary@gmail.com` it arrived.** The mail is only a notice:
   its lane, the ticket number and a link to the ticket in the admin, with no
   name, address or message and no Reply-To. Resend sends it from
   `noreply@tomokichidiary.com` using the domain-scoped
   `MAIL_API_KEY_TOMOKICHI_DIARY` secret. The message is read and answered in
   the admin, so the ticket keeps the whole conversation. If filing fails, the
   email carries the full message and sets the reader as Reply-To; Resend
   delivers it directly to the fixed inbox as the fallback copy.

The reader sees success when either went through, and `?error=unavailable` only
when neither did; whichever failed is logged (`contact.not_mailed` /
`contact.not_filed`).

The ticket goes through the `INQUIRY` service binding to the platform's
`Intake` entrypoint (`tomokichi-admin-core`), declared in
`apps/api/cloudflare.config.ts` with `props.projects = ["tomokichi-diary"]`. The
project slug `tomokichi-diary` must be registered on the platform.

The Turnstile secret, IP hash salt and rate limiter are required for the form.
`INQUIRY` and Resend are independent storage and notification paths; the form
reports `unavailable` only when neither succeeds. Without the Resend key, a
filed ticket is still accepted but no inbox notice is sent:

| Setting                        | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `TURNSTILE_SECRET_KEY`         | Verifies the challenge token                    |
| `IP_HASH_SALT`                 | Salts the sender hash used for rate limiting    |
| `MAIL_API_KEY_TOMOKICHI_DIARY` | Sends the ticket notice through Resend          |
| `CONTACT_RATE_LIMITER`         | Rate Limiting binding in `cloudflare.config.ts` |

Register the domain-scoped Resend key on the Diary API Worker as well as
`tomokichi-admin-core` (the value is entered interactively and never belongs in
the repository):

```bash
pnpm --filter @tomokichi/api exec wrangler secret put MAIL_API_KEY_TOMOKICHI_DIARY --name tomokichi-diary-api
```

The public site key (widget `tomokichi-diary-contact`) is built in from
`apps/web/src/lib/site.ts`; `PUBLIC_TURNSTILE_SITE_KEY` overrides it, and an
empty value hides the form.

Set `TURNSTILE_EXPECTED_HOSTNAME=tomokichidiary.com,www.tomokichidiary.com` in
production so a valid token is also checked against an expected hostname and
the `contact` widget action.

#### Contact lanes

What a reader can pick (記事について, お仕事・取材の相談, …) and which lane (動線)
each choice belongs to — `general` (一般) or `media` (メディア・お仕事) — is one
table, `packages/domain/src/rules/contact-topics.ts`. The form's choices, the
lane a message is filed under, the tag on the notification mail and the lane
badge in the admin all come from it. The form posts a topic's key (its label is
still accepted from older pages) and the ticket is filed with the label as its
subject, which is how the admin recovers the lane; renaming a label moves the
old wording to the topic's `aliases`.

Ways to change the flow, from smallest to largest:

- **Move or add a choice:** edit the table.
- **A page of its own for one lane:** render `<ContactForm lane="media" />`;
  it lists only that lane's topics. `/contact?topic=<key>` preselects a topic
  from a link.
- **Handle media enquiries apart** (own reply templates, signature or sending
  address): register a second project on the platform, point the lane at it in
  `INQUIRY_PROJECT_BY_LANE` (`apps/api/src/inquiry.ts`), add the slug to both
  bindings' `props.projects`, and have the admin choose the operator client by
  lane. Today both lanes share `tomokichi-diary`.

Messages received before the switch stay in D1 `contact_messages` and are still
readable in the admin under お問い合わせ → 切替前の受信箱. Nothing new is written
there.

### Admin inquiries

The admin's お問い合わせ screen is where this site's contacts are worked as
tickets on the inquiry platform, from `admin.tomokichidiary.com`.

- **Inbox (the screen's top):** every ticket on one list, open ones first and
  newest first, with counts on top (未対応, 新着, each lane's open ones,
  期限超過, すべて) that double as filters, plus a status select, lane chips
  and search. The API reads the whole inbox from the platform (pages of 100, up
  to 2,000) so the counts and the lane filter are exact; the platform itself
  cannot filter by lane.
- **A ticket:** the conversation (a mail answer's quoted history folded away),
  a 進め方 panel offering only the next steps the platform allows (確認 → 対応中
  → 返事待ち / 解決（対応完了・対応不要・迷惑）→ クローズ, 再開), the next action
  with a due date, internal notes, and the reply.
- **A reply** is laid out as the mail it becomes: 宛先, 差出人
  (「ともきちの旅行日記」 <support@tmkch.io>, from the studio seed), 件名, the body
  starting from the greeting template filled in for the reader, and the closing
  「以上、よろしくお願いいたします。」 and signature the platform adds. Sending
  goes through a preview of the whole mail. A ticket that is new or only
  acknowledged is moved to 対応中 first; after sending it goes to 返事待ち,
  解決済み or stays 対応中, as chosen.
- **The subject** is filled in (the lane's default, or the inserted template's)
  and editable on the first reply to a form message. The platform takes a
  reply's subject only from the template named on send, so the API writes it
  to an inactive carrier template (`diary_system_subject`, never listed) just
  before sending. After the first reply the platform keeps the conversation's
  `Re:` subject, and the screen shows it read-only.

A reply that still contains a `{{...}}` placeholder is refused, and a send the
platform could not mail answers `INQUIRY_MAIL_FAILED`. The reader's answer
joins the same ticket and moves it back to 対応中.

お問い合わせ → 署名・テンプレート holds the signature and this site's reply
templates. The defaults (`apps/api/src/inquiry-templates.ts`: the greeting and
replies for articles, requests, questions, work and press, photo use, sales
pitches and closing a ticket) are created the first time the templates or a
reply are opened, only when their key is missing, so edits in the admin win.
The signature is set to the site's own the first time a reply is opened, if
the project still signs with the deployment's Tomokichi Studio signature. A
template fills `{{userName}}` with the name the reader typed and `{{appName}}`
/ `{{supportUrl}}` with this site's; anything else in braces is filled in by
hand before sending. Naming a template `区分：名前` groups it under 区分 in the
reply's template picker.

The diary API reaches the platform through the `INQUIRY_OPERATOR` service
binding to the core Worker's `ProjectOperator` entrypoint (inquiry-platform
v0.10.0, the release the studio deploys), after this site's own admin gate has let the operator in. The
binding's `props` grant only `tomokichi-diary`: the platform filters every
list to it and answers any other project's ticket as missing. Nothing is
configured on the platform's API gateway (`admin.tmkch.io`) or its Access
application — that host only serves the platform's own API.

Each change is audited on the platform as `tomokichi-diary-api:<who>`, where
`<who>` is `access:<Access subject>` or `admin-token`. Notification mail and
push links open `https://admin.tomokichidiary.com/#/inquiries/<ticket number>`
(the studio seed's `mailSettings[].ticketUrlTemplate`).

The sending address and name, and whether the platform sends its own "new
ticket" mail, are the studio's `deploy/inquiry-platform/seed.ts`
(`mailSettings`). The blog sets `notifyByEmail: false` there, since its own
notification mail (above) already carries the ticket link.

### `API_UNAUTHORIZED`

Admin access is granted two ways, and either is enough:

1. **Cloudflare Access** — a valid `Cf-Access-Jwt-Assertion` on the request,
   verified against the team's public keys. Requires `ACCESS_TEAM_DOMAIN` and
   `ACCESS_AUD` to be set as vars.
2. **Bearer token** — `ADMIN_TOKEN`, compared in constant time.

Configuring Access does not disable the token. Delete `ADMIN_TOKEN`
(`wrangler secret delete ADMIN_TOKEN --name tomokichi-diary-api`) to make Access the only way in.

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

## Status probe

`GET https://api.tomokichidiary.com/internal/status-probe` は、共通ステータス基盤（tomokichi-status）が 10 分おきに読む、お問い合わせ経路の読み取り専用の状態。契約は tomokichi-status の `docs/adr/0001-product-status-probe.md`。

- `STATUS_PROBE_TOKEN` が未設定、またはトークンが違うときは、存在しないルートと同じ 404 を返す。設定は `wrangler secret put STATUS_PROBE_TOKEN --name tomokichi-diary-api`。同じ値を tomokichi-status の Netlify 環境変数 `STATUS_PROBE_TOKEN_DIARY` に入れる。入れ替えるときは両方を同時に更新する（その間、ステータスは「確認できません」になる）。
- 読むもの: `INQUIRY_OPERATOR` の `project()`（Core との疎通）と、`TURNSTILE_SECRET_KEY` の有無。チケット・メール・D1 には書き込まない。
- `mail_delivery` は常に `UNKNOWN`。この初期プローブでは配送キューの集計を実装していないため、Core 疎通だけで配信正常とは判定しない。SDK は現在 v0.10.0。
- レート制限は `STATUS_PROBE_RATE_LIMITER`（namespace 3003、毎分 6 回。既存のいいね制限 3002 と分離）。
- `inquiry_core: DOWN` のときは、[Inquiry](#api) の `admin_bridge` 系のログと、inquiry-platform の運用文書を見る。

## ANALYTICS_INVALID_RANGE / ANALYTICS_UNCONFIGURED / ANALYTICS_DISPATCH_FAILED / ANALYTICS_INVALID_DATA / ANALYTICS_COLLECTION_FAILED

非公開集計の認証、期間検証、sourceごとの失敗復旧は [analytics/OPERATIONS.md](analytics/OPERATIONS.md) と [analytics/SECURITY.md](analytics/SECURITY.md)。失敗時も旧成功集計とBQ履歴を保持する。GA4/GSC exportや記事公開処理を停止しない。

## MONETIZATION_INVALID

収益化設定の公開前検証・参照・状態遷移に問題があります。重複／消失マーカー、見出しと本文600字未満、画像・カード隣接、1枠上限、未登録ユニット、別記事の実験・未登録案件の参照を確認してください。実施済み実験の条件書換え・再開はできません。DBを直接修正せず、管理画面から修正・保存後、公開チェックを再実行します。切り戻しと機能フラグは [収益化Phase 2](monetization-phase2.md#切り戻し) を参照してください。0017はexpandのみで、旧版へコードを戻す際にもdropは不要です。

## 問い合わせの返信メールと配信通知

- 管理画面の差出人は `contact@tomokichidiary.com`。フォームの運営宛て新着通知は引き続き `noreply@tomokichidiary.com`。
- 返信画面の「名乗り」で「ともきちの旅行日記を運営しております、髙木です。」「ともきちの旅行日記を運営しております、ともきちです。」を切り替えられる。回答本文を保持して冒頭だけを置き換える。
- 一次受付メールの実際の Message-ID を `In-Reply-To` と `References` に付け、管理画面の回答を同じ会話の返信として送る。送信 API が返す transport ID と、受信側のメールに付く Message-ID は別の識別子。仮の ID を実際の配信 ID として使わない。
- Resend の Webhook：URL `https://api.tomokichidiary.com/webhooks/resend`、イベント `email.sent`。Signing secret は Diary API の `RESEND_WEBHOOK_SECRET` に登録する。API キーとは別の値であり、チャットや Git へ貼らない。
- 署名鍵の登録：`pnpm --filter @tomokichi/api exec wrangler secret put RESEND_WEBHOOK_SECRET --name tomokichi-diary-api`。登録の有無は secret list で名前だけ確認する。
- Webhook は Svix の ID・時刻・署名を未加工の本文と照合し、5 分以上のずれ、不正な署名、64 KiB 超の本文を拒否する。Core へは transport ID と Message-ID だけを渡す。宛先や件名、本文を転送しない。他プロジェクトと noreply の配信通知は取り込まない。
- Core は確認済みの配信 ID が届くまで返信を保留する。`受付メールの送信情報を確認中です` が出たときは、Webhook の配信状況・署名鍵を確認する。新規メールに切り替えて送らない。
- 署名鍵が未設定の Webhook は 404。Webhook が送信記録より先に到着した場合は 503 を返し、Resend の再配信を待つ。同じ配信の再通知は冪等に処理する。
