# Architecture

Bobby has two halves joined by one document format:

```
                 extraction (src/, Bun)                          viewing (public/, browser)
┌──────────────────────────────────────────────────┐        ┌────────────────────────────────┐
│ gh + git ──► diff ──► analysis ──► change tree ──►│ graph ►│ core runtime ──► view modules  │
│                                  (static | Claude)│  v1    │   (focus, walk, marks, …)      │
└──────────────────────────────────────────────────┘        └────────────────────────────────┘
                         ▲                                              │
                         └──────────── local HTTP server ◄──────────────┘
                              (graph, state, settings, review submit)
```

- **Extraction** turns a GitHub PR into a `bobby.review-graph/v1` document ([SPEC.md](../SPEC.md)).
- **Views** only ever read that document. They never see git, GitHub or the analysis.
- A small **local server** serves the UI and the graph, persists review state, and posts the review to GitHub.

Because the graph is the only contract, any extractor works with any view: `bobby extract` writes a graph to a file, and `bobby open` views a graph from anywhere.

## Repository layout

```
src/                     extraction, server and CLI (TypeScript, run directly by Bun)
  cli.ts                 entry point: argument parsing, caching, orchestration
  git.ts                 subprocess helper, PR resolution, fetch, file reads, review comments
  diff.ts                unified-diff parser, hunk hashing, low-signal classification
  analyze.ts             units, static edges and refs, the heuristic tree, finalize
  syntax.ts              tree-sitter: declarations, references, imports (TS/JS, Python, Go, Java, Rust)
  resolve.ts             imports → files, names → declarations, at the PR's head
  llm.ts                 Claude's change tree (headless `claude -p` with a JSON schema)
  graph.ts               packs everything into a ReviewGraph; wires edges; builds the walk
  server.ts              Bun HTTP server: static files + /api/*
  assets.ts              public/ embedded in a compiled binary (filled by scripts/build.ts)
  local.ts               no PR: the branch you're on vs a detected base
  state.ts               ~/.bobby: review state, caches, settings
  types.ts               internal types shared by the pipeline
public/                  the UI: plain ES modules, no build step
  index.html             shell: header, breadcrumb bar, view slot, key hints, overlay, toast
  app/core.js            shared runtime: graph index, focus, walk, levels, marks, settings
  app/main.js            boot, settings → CSS, view mounting, keyboard
  app/chrome.js          everything around the view: header, breadcrumbs, hints, modals, toasts
  app/palette.js         command palette (⌘K): commands, cores, files and pages in one search
  app/tour.js            callouts pointing at the UI: the first-run tour and what's-new notes
  app/code.js            code rendering: pages, cards, whole files, folding, context, comments
  app/theme.css          design tokens (dark and light) and shared styles
  app/views/             one module per view, plus index.js (the registry)
schema/                  JSON Schema for review-graph v1
scripts/check.sh         typecheck + syntax check (the build gate)
.githooks/               commit-msg and pre-commit hooks
```

There's no bundler and no framework. `src/` runs under Bun as TypeScript; `public/` is served as-is. The only runtime dependency in the browser is highlight.js from cdnjs, plus Google Fonts.

## One run, end to end

1. **Resolve** (`git.ts › resolvePr`). `gh pr view` gives metadata, including the head commit. A local clone is found or made.
2. **Cache check** (`cli.ts`). If `~/.bobby/cache` has graphs for this head commit and the same `VERSION`, they're reused and steps 3–6 are skipped. Review comments are always re-read.
3. **Fetch and diff** (`git.ts › fetchPr`, `diff.ts`). The PR head and base are fetched into `refs/bobby/<n>/`, and the diff is taken against the merge-base.
4. **Analysis** (`analyze.ts`). Hunks are grouped into units. For supported languages, tree-sitter (`syntax.ts`) and import resolution (`resolve.ts`) find the static edges and the references to untouched code that really bind to the changed declarations; other languages fall back to `git grep` word matches.
5. **Static tree** (`analyze.ts › heuristicTree`), then **graph** (`graph.ts › buildGraph`). The UI starts with this.
6. **Claude tree** (`llm.ts`), in the background. When it's ready, it's built into a second graph and the UI offers to switch.
7. **Serve** (`server.ts`). The browser loads the graph and session, and talks back over `/api/*` as you review.

Details: [Extraction pipeline](extraction.md) · [Server and state](server-and-state.md) · [Browser runtime](frontend.md).

## Design principles

- **Views are replaceable; the graph is not.** Anything a view needs goes into the graph format (with a SPEC update) rather than into a side channel.
- **Never lose the reader's place.** Navigation follows `graph.walk` in every view. Swapping trees keeps you on the same node, and marks are keyed by content.
- **Static first, smart later.** The static tree is instant and deterministic. Claude refines it but can only reference ids that static analysis produced.
- **No hunk is ever skipped.** Anything the tree didn't place is appended as extra cores (`finalize`).
