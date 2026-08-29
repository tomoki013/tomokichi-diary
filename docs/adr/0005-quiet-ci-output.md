# CI is quiet on success and structured on failure

## Context

A passing build that prints thousands of lines costs a reader — human or agent — real effort to confirm nothing is wrong.

## Decision

Success prints one line. Failure prints only the failed checks, each with a stable code, the actual and expected values and a rerun command. Full logs go to `.artifacts/ci/`, and every run writes `summary.json`.

## Why

The scarce resource when diagnosing a failure is attention. Ranking output by what failed, and keeping the machine-readable form beside it, means the first thing read is the thing that matters.

## Consequences

Checks must report structured findings rather than exit codes alone; `scripts/lib/report.ts` defines the shape.
