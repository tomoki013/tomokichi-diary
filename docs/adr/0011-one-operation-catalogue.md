# ADR 0011: One operation catalogue for the admin, the API and the internal MCP servers

Status: accepted — 2026-11-10

## Context

Each admin capability was written four times: an API route, the admin's client, the Operator
MCP's client and tool definition, and a regular-expression allow-list of paths the MCP may use.
They drifted. The MCP lacked unpublishing, scheduling, uploads, affiliate offers and more; the
audit log derived operation names by parsing URLs. The admin itself had grown one screen per
feature with no shared structure.

## Decision

Every capability is an operation defined once in `packages/contracts/src/operations`: name,
input validator (which also describes itself as a JSON schema), output type, kind
(`read` / `write` / `delete`), surface (`operator` / `analytics` / `admin-only`), Japanese
description, MCP tool name and confirmation, and audit target.

- The API exposes one route, `POST /v1/admin/ops/<name>`. It decides who may run the operation
  from its kind and surface, validates the input and writes the audit entry. Handlers live in
  `apps/api/src/ops/handlers`, one per operation, enforced by type.
- The admin calls operations by name with the catalogue's types.
- The Operator and Analytics MCP servers list the operations of their surface as tools and run
  them through the same route. The local stdio operator does the same with a bearer token.
- Deletes are never MCP tools. `admin-only` is reserved for the inbox (`inquiry.*`, which the
  MCP servers may not even read), revoking connections, and confirming travel facts. A test
  fails if anything else becomes admin-only.
- Travel facts: anyone may propose (stored as candidates); only the owner in the admin may
  confirm, whatever the provenance. Saving never confirms, and changing a confirmed claim
  returns it to the queue. This widens ADR 0009 from firsthand facts to all facts. The in-API
  AI extraction is removed; extraction is done by the AI client connected over MCP.

## Consequences

A new capability is one spec and one handler, and is then available in the admin and over MCP
without further work. Existing MCP tool names are kept, so connected clients keep working.
The admin and the API must be released together; the database is unchanged, so rolling back
the three Workers restores the previous version.
