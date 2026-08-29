# Markdown is the canonical article body

## Context

The body of an article had to live somewhere that outlives Astro, React and this CMS. Candidates were HTML, MDX and Markdown.

## Decision

Store `bodyMarkdown`. HTML is generated at build time; MDX is not used anywhere.

## Why

HTML would freeze presentation into the data and make a frontend change a data migration. MDX would tie the content to a React-flavoured toolchain. Markdown is readable by people, diffable in Git, trivially exportable and understood by every renderer we might move to.

## Consequences

Rich content Markdown cannot express is modelled as embeds (ADR 0007) rather than as raw HTML in the body.
