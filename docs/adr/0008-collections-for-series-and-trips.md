# Series and trips are modelled as collections

## Context

The previous site published `/series/*` and `/journey/*` from hard-coded arrays. Dropping them would have broken 13 live URLs.

## Decision

A `Collection` entity with `kind` of `series` or `journey`, and an ordered membership table.

## Why

Both are ordered groups of articles with their own URL space, which is more than a tag and less than a category. Modelling them keeps their URLs alive and makes their pages data-driven.

## Consequences

Trips moved from `/journey/j-2024-02-26` to `/trips/hokkaido-2024-02`, with 301s from the old paths.
