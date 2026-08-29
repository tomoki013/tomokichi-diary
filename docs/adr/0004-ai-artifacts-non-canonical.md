# Generated output is never a source of truth

## Context

Summaries, keyword suggestions and audits will be generated. They could be written straight into revisions.

## Decision

Generated output is stored in `ai_artifacts`, attached to an entity and the revision it was derived from. Nothing reads it as content until a human adopts it into a revision.

## Why

A generated summary that silently becomes the meta description is unattributable and unreviewable. Keeping it beside the content makes staleness detectable and adoption deliberate.

## Consequences

The AI provider is behind a port, and the public site builds with no provider configured at all.
