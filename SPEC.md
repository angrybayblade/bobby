# Review graph v1

`bobby.review-graph/v1` is the contract between **extracting** a PR and **viewing** it. Graphs written under the tool's old name, `prfocus.review-graph/v1`, are the same format and still open.

- Extractors turn a PR into a graph. This repo ships one: git and static analysis, refined by Claude.
- Views render a graph. This repo ships four: Flow, Outline, Lens and Diff.
- Neither side knows about the other, so any extractor works with any view.

The machine-readable schema is in [`schema/review-graph.v1.schema.json`](schema/review-graph.v1.schema.json).

```sh
bobby extract <pr> -o pr.json     # produce a graph
bobby open pr.json                # view any graph, wherever it came from
```

## Model

```
PR ─┬─ files ── hunks                        (the raw diff)
    ├─ nodes                                 (things worth looking at)
    │    ├─ change   chg:<file>#<symbol>     code the PR touched → hunkIds
    │    └─ context  ctx:<path>:<line>       code it did not touch → snippet
    ├─ cores[]                               (ordered: foundations first)
    │    └─ bands
    │         upUnchanged → upChanged → core → downChanged → downUnchanged
    │              └─ placements (node + title + why + risk)
    ├─ edges                                 (placement → placement, within a core)
    ├─ walk                                  (placement ids in review order)
    ├─ lowSignal                             (hunk ids to collapse)
    ├─ discussion?                           (existing review comments, by path + line + side)
    └─ definitions?                          (path → names on its new-side diff lines, and where each is declared)
```

### Local reviews

`pr.provider` is `"github"` for a pull request, or `"local"` for a branch reviewed in its repo without one. A local graph has `number: 0`, an empty `url`, plus `branch` and `baseRef` (what it's compared with); `headSha` may be a tree id when it includes uncommitted changes. v1 consumers that only expect `"github"` should treat any other provider as having no PR page to link to.

`pr.commit` is optional: the graph covers one commit of the PR, `{ sha, subject }`, diffed against its parent, or with `from`, the commits after `from` up to `sha`. `headSha` is then `sha` and `baseSha` the parent or `from`, rather than the PR's head and merge-base. Discussion holds only comments written on that commit.

### Node vs. placement

A **node** is a piece of code. A **placement** is that node put in a core's band, with a reason (`why`).

The same node can be placed more than once. For example, a changed type can be upstream of two cores. Only the first placement is reviewed; later ones carry `repeatOf` and are drawn as "already seen".

### Bands

| band | node kind | meaning |
|---|---|---|
| `upUnchanged` | context | existing code the core relies on |
| `upChanged` | change | changed code the core relies on or reacts to |
| `core` | change | the change itself |
| `downChanged` | change | changed code that exists because of the core |
| `downUnchanged` | context | untouched code whose behaviour the core can change; the main place bugs hide |

### Edges

Edges always point downstream (`from` is upstream of `to`) and stay inside one core. Together they form the chain:

```
upUnchanged → upChanged → core → downChanged → downUnchanged
```

An untouched upstream node can attach to a changed upstream node, and an untouched downstream node can hang off a changed downstream node. That's how the tree gets depth. `label` names the relationship, for example "uses `retryMethods`".

### Hooks

A core may carry `hook`: one short question to lead with, usually about what could break ("Do untouched callers still pass a string id?"). Views show it when the reviewer enters the core, so each core starts with something specific to look for. It's optional and additive: v1 consumers that don't know it ignore it.

### Walk

`walk` is the canonical traversal: cores in order, and within each core the bands in the order above, with repeats left out. Views may present it differently, but "next" and "previous" always follow `walk`. That way, switching views never changes what comes next.

### Discussion

`discussion` is optional. It holds inline review comments already on the PR, so a reviewer sees what others said before writing. Each one is anchored like a GitHub review comment: `path`, `line` and `side` (`RIGHT` for the new file, `LEFT` for the old one). Comments whose line no longer exists in the diff are left out. Each may carry `avatar`, its author's GitHub avatar URL; `replyTo`, the id of the first comment of its thread; and, for a comment on a range of lines, `startLine` and `startSide`, its first line (`line` is its last). Adding it didn't change the version: v1 consumers that don't know the field ignore it.

### Definitions

`definitions` is optional, and also doesn't change the version. It maps a file path to the names used on its new-side lines in the diff (added and context lines), for an inspector: `{ line, col, len, name, to?, ext?, via? }`. `col` is 0-based in UTF-16 code units, as LSP counts. Each name is declared at `to` (`{ path, line, end? }`, in the repo at head), or outside the repo (`ext`: a package name, or the language's built-in types), or wasn't found (neither). `via` says how it was found: `syntax` (imports and the syntax tree) or `lsp` (a language server, which also places locals and members of values). Removed lines aren't covered.

## Stability rules (for review state)

Views and tools that store review progress should key it on content, not ids:

| what | key |
|---|---|
| changed code | `hunk.hash`, which is stable across pushes when the hunk is unchanged |
| untouched code | `ref:<path>:<line>` |
| position | node id, which is stable across tree regenerations for the same diff |

Placement ids (`p12`) and core ids (`c3`) are only stable within a single graph.

## Writing a view

A view is an ES module in `public/app/views/` that default-exports:

```js
export default {
  id: "flow",                 // used in settings and the URL
  name: "Flow",               // shown in the switcher
  hint: "Node-link canvas",   // tooltip
  available(graph) {},        // optional: false hides the view for this review (Conversation, for a local branch)
  mount(el, app) {            // el: the view's container; app: shared runtime (below)
    return {
      update(reason) {},      // "focus" | "level" | "marks" | "comments" | "graph" | "settings" | "resize" | "resume"
      destroy() {},
      hide() {},              // optional, kept views only: switched away from; "resume" follows when shown again
    };
  },
};
```

`app` exposes:
- the data: `graph`, `index` (lookups), `focus` (placement id) and `level` (0 overview · 1 core · 2 page);
- navigation: `setFocus(id)` and `setLevel(n)`;
- review state: `isReviewed(id)` and `isFlagged(id)`;
- `renderPage(el, placementId)`, which renders the shared code page (title, why, comments, code) with context expansion, folding and word-level diff, and `renderNode(el, placementId)`, which renders just comments and code for a card that already shows the title and why; `renderFile(el, placementIds)` renders a whole file as titled sections, for file-level viewers;
- `settings`.

Register the view in `public/app/views/index.js`.
