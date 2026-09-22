# legacy-sync — temporary, delete after the cutover

Everything in this directory exists only while the previous Next.js site
(`../travel-diary`) is still serving `tomokichidiary.com`. It keeps the two
sites showing the same article content until DNS moves to Diary 2.0.

```
export/ (Diary 2.0, canonical)
   │
   ├─ pnpm content:parity   →  docs/migration/content-parity-report.md
   │                           CONTENT_PARITY_MISMATCH when the sites differ
   │
   └─ pnpm legacy:export    →  ../travel-diary/posts/*.md   (one way, NEW → OLD)
                                ../travel-diary/public/images/** (missing files only)
```

Rules the code enforces:

- Diary 2.0 (`export/`) is the source of truth. Nothing here ever writes into
  `export/` or the database from the legacy repository.
- The sync is one-directional. There is no OLD → NEW path; the one-time
  integration of legacy-only edits was done by hand through
  `pnpm content:revise` and is recorded in `docs/migration/legacy-content-sync.md`.
- Comparison happens on a `NormalizedArticle`, not on Markdown files, so
  differences in framework conventions (`{{embed:…}}`, redirected legacy paths,
  frontmatter key names) are not reported as content differences.

## Removal checklist (after `tomokichidiary.com` points at Diary 2.0)

1. Delete this directory, `scripts/content-parity.ts` and `scripts/legacy-export.ts`.
2. Remove the `parity` step from `scripts/ci.ts` and the `content:parity` /
   `legacy:export` scripts from `package.json`.
3. Remove the `LEGACY_REPO` checkout from `.github/workflows/ci.yml`.
4. Remove `CONTENT_PARITY_MISMATCH` from `packages/contracts/src/error-codes.ts`
   and its runbook entry in `docs/OPERATIONS.md`.
5. Delete `docs/migration/content-parity-report.md`; keep
   `docs/migration/legacy-content-sync.md` as the record of what was merged.

Nothing else depends on this directory.
