# ADR 0009: Add travel knowledge beside article prose

Status: accepted — 2026-09-04

## Context

Markdown is the right canonical form for authored prose, but extracting dates,
prices, routes and evidence from prose on every delivery surface loses meaning.
Moving every existing article into a new schema at once would endanger production
URLs and content.

## Decision

Keep immutable article revisions and add a separately versioned travel-knowledge
graph. Facts, sources and experienced routes are independent entities with stable
IDs. `ArticleKnowledge` links one published revision to the relevant entities.
D1 persists the graph through an application port; the committed export is its
reproducible adapter-neutral snapshot.

## Consequences

Articles without knowledge records render exactly as before and appear in a generated
human-review backlog. Migrated articles gain human and machine-readable projections
from the same data. URL routes and travel routes retain distinct types. The editor,
WebMCP adapter and public MCP/MCP App all call application-layer commands or projections;
none can grant AI authority to verify firsthand evidence.
