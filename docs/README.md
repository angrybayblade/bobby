# Bobby docs

## User manual

- [Getting started](getting-started.md): requirements, install, commands, flags, and what's written to disk
- [Reviewing a PR](reviewing.md): the walk, zoom levels, keys, marks, comments, submitting, focus aids
- [Views](views.md): Flow, Outline, Lens and Diff, and how to drive each one
- [Settings](settings.md): every setting and the design choices behind the UI
- [What leaves your machine](privacy.md): what Bobby sends to Claude, GitHub and others, and how to turn each off

## Implementation

- [Architecture](architecture.md): the extraction/graph/view split, repo layout, one run end to end
- [Extraction pipeline](extraction.md): fetch, diff, static analysis, change trees, Claude, graph building, caching
- [Server and state](server-and-state.md): the HTTP API, review submission, `~/.bobby` and content-keyed marks
- [Browser runtime](frontend.md): boot, the `app` runtime and events, code rendering, how each view works
- [Review graph v1](../SPEC.md): the format between extraction and views ([JSON Schema](../schema/review-graph.v1.schema.json))
- [Contributing](contributing.md): setup, commit rules, iterating on the UI, common changes
