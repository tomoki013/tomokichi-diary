# The core does not know about any framework

## Context

Astro, Hono and Cloudflare are current choices, not permanent ones.

## Decision

`packages/domain`, `application`, `contracts`, `data` and `seo` are plain TypeScript. Framework and vendor code lives in `apps/` and `infrastructure/`, reached through ports.

## Why

Business rules outlive infrastructure. Keeping them free of framework types means a frontend or database change is an adapter change, and it makes the rules directly testable with no harness.

## Consequences

A dedicated architecture tool was rejected as premature; `scripts/check-boundaries.ts` plus package dependencies enforce it and run in CI.
