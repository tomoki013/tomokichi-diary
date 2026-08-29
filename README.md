# Tomokichi Diary 2.0

A travel publication whose content, business rules and URLs do not belong to any
framework. Astro, Hono, Cloudflare, D1 and R2 are adapters around a
plain-TypeScript core.

```bash
pnpm install
pnpm run ci
```

`pnpm run ci` runs the whole pipeline — format, lint, types, boundaries, tests,
build, route integrity, SEO integrity, internal links and the Lighthouse budget
— and behaves identically in CI. On success it prints one line; on failure it
prints only what failed, with a stable code and a rerun command.

## Layout

```
apps/web      public site (Astro, static, no client JavaScript)
apps/admin    admin UI (Vite + React)
apps/api      admin API (Hono on Cloudflare Workers)
packages/     domain, application, contracts, data, seo — framework-free
infrastructure/  D1 and R2 adapters
export/       the content graph, committed; the site is built from this
migration/    baseline of the previous site's URLs and SEO
docs/         architecture, data model, runbook, ADRs
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — applications, packages, dependency direction, commands
- [Data model](docs/DATA_MODEL.md) — entities and how they relate
- [Operations](docs/OPERATIONS.md) — a runbook keyed by stable error code
- [Decisions](docs/adr/) — why the load-bearing choices were made
