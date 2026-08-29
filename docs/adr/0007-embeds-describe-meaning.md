# Embeds describe content, not components

## Context

Cost tables, maps and disclosures cannot be expressed in Markdown, and the obvious shortcut is to store a component name.

## Decision

An embed stores `type`, `schemaVersion` and a payload describing the thing itself. The body references it by anchor key. No frontend identifier is ever stored.

## Why

A stored component name makes the data unusable outside the frontend that defined it. Describing the content instead lets a cost report render as a table today and as something else later, in any frontend.

## Consequences

Each embed type needs a renderer per frontend, and `schemaVersion` must be bumped when a payload shape changes.
