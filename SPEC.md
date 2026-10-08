# Review graph v1

`prfocus.review-graph/v1` is the contract between **extracting** a PR and **viewing** it.

- Extractors turn a PR into a graph. This repo ships one: git and static analysis, refined by Claude.
- Views render a graph. This repo ships three: Flow, Outline and Lens.
- Neither side knows about the other, so any extractor works with any view.

The machine-readable schema is in [`schema/review-graph.v1.schema.json`](schema/review-graph.v1.schema.json).

```sh
prfocus extract <pr> -o pr.json     # produce a graph
prfocus open pr.json                # view any graph, wherever it came from
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
    └─ discussion?                           (existing review comments, by path + line + side)
```

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

### Walk

`walk` is the canonical traversal: cores in order, and within each core the bands in the order above, with repeats left out. Views may present it differently, but "next" and "previous" always follow `walk`. That way, switching views never changes what comes next.

### Discussion

`discussion` is optional. It holds inline review comments already on the PR, so a reviewer sees what others said before writing. Each one is anchored like a GitHub review comment: `path`, `line` and `side` (`RIGHT` for the new file, `LEFT` for the old one). Comments whose line no longer exists in the diff are left out. Adding it didn't change the version: v1 consumers that don't know the field ignore it.

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
  mount(el, app) {            // el: the view's container; app: shared runtime (below)
    return {
      update(reason) {},      // "focus" | "level" | "marks" | "graph" | "settings" | "resize"
      destroy() {},
    };
  },
};
```

`app` exposes:
- the data: `graph`, `index` (lookups), `focus` (placement id) and `level` (0 overview · 1 core · 2 page);
- navigation: `setFocus(id)` and `setLevel(n)`;
- review state: `isReviewed(id)` and `isFlagged(id)`;
- `renderPage(el, placementId)`, which renders the shared code page with comments, context expansion and word-level diff, so a view only decides what goes around the code;
- `settings`.

Register the view in `public/app/views/index.js`.
