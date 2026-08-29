# The public site is built from a committed export

## Context

Astro would need database access at build time to generate pages from D1, which couples the frontend to Cloudflare and makes builds non-reproducible.

## Decision

`pnpm export:data` writes the whole content graph to `export/` as Markdown plus JSON, and that directory is committed. `astro build` reads only those files.

## Why

It makes the site buildable from the repository alone, gives content a readable history in Git, keeps Astro unaware of D1, and doubles as the vendor-neutral backup the design asks for.

## Consequences

Publishing is a two-step operation: publish in the admin, then export and deploy. The export must be regenerated whenever content changes.
