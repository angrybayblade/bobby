# Browser runtime

The UI in `public/` is plain ES modules with no build step and no framework. `index.html` lays out five regions: `#top` (header), `#where` (breadcrumbs), `#view` (the active view), `#keys` (key hints), plus `#overlay` and `#toast`.

## Boot (`app/main.js`)

1. Fetch `/api/graph` and `/api/session` in parallel, and create the runtime with `createApp`.
2. Attach the rendering helpers to `app` (`renderPage`, `renderNode`, `renderFile`).
3. Apply settings to the document: `data-theme`, `data-motion`, and CSS variables for font, size and word spacing.
4. Pick the starting focus. Resume on the stored `lastNodeId` at the Page level, otherwise go to the first unreviewed page at Overview.
5. Mount the view: from the URL hash if present, otherwise the last one used (`settings.view`).
6. Start the chrome. Show the welcome-back card if there's progress or a parked thought.
7. If Claude is pending, poll `/api/status` every 4s and toast when its tree is ready.

**Deep links for testing**: `#view=lens&level=1&p=5` picks the view, level and walk position (1-based). `window.prfocus` exposes the runtime in the console.

## The runtime (`app/core.js`)

`createApp` returns the `app` object, the only thing views talk to.

**Data and lookups**
- `graph`, and `index` from `indexGraph`: maps of placements, nodes, hunks, cores and edges by core. `index.walk` is `graph.walk` plus two pseudo-pages, `@low` (low-signal) and `@done` (end). `index.walkPos` maps a placement id to its position in the walk.
- `get(pid)` → `{ pl, core, ci }`, `nodeOf(pid)`, `hunksOf(pid)`, `neighbours(pid)`, `stat(pid)` (+/− counts), `canonical(pid)` (follows `repeatOf`).

**Navigation.** `focus` (a placement id) and `level` (0 Overview, 1 Core, 2 Page).
- `setFocus(pid, { level })` always resolves repeats to their canonical placement, and saves the position to the server, debounced by 500ms.
- `step(±1)`, `stepCore(±1)` and `nextUnreviewed()` all move along `index.walk`.
- `setLevel(n)` is clamped to 0–2.

**Review state.** `markKeys(pid)` gives content keys (hunk hashes or `ref:path:line`). `isReviewed`, `isFlagged` and `mark(pid, mark)` work on those keys, and `progress()` gives done/total and a rough minutes-left estimate (12s per page plus 1.1s per changed line).

**Events.** `app.on(fn)` and `app.emit(reason)`. The reasons are:

| Reason | Fired when |
|---|---|
| `focus` | The focused placement changed |
| `level` | The zoom level changed |
| `marks` | A page was marked or un-marked |
| `comments` | A draft was added, deleted or submitted |
| `graph` | `replaceGraph` swapped in Claude's tree (focus is kept by node id) |
| `settings` | A setting changed |
| `llm` | Claude's status changed |
| `resize` | The window resized (sent to the view by `main.js`) |

`main.js` forwards every reason to the mounted view's `update(reason)`.

**Settings.** `settings` is `DEFAULT_SETTINGS` overlaid with the saved file. `saveSettings(patch)` updates it locally, POSTs the patch and emits `settings`. `useKey(k)` counts key uses so hints can fade.

## Keyboard (`app/main.js`)

One `keydown` handler. It ignores typing in inputs and any modified keys, and lets an open modal take `esc`/`enter`. A view can claim keys by returning `keys: { [key]: fn }` from `mount`; those win over the global map. Every handled key calls `useKey`.

## Chrome (`app/chrome.js`)

Everything outside the view: the header (title, Claude status pill, progress, view switcher, drafts pill, settings), the breadcrumb bar (crumbs, parked thought, level dots), key hints per level, and modals (help, settings, submit, park, welcome back). Also toasts and the break-reminder timer, which counts only visible, recently active minutes. It re-renders on `focus`, `level`, `marks`, `graph`, `settings`, `comments` and `llm`.

To add a setting, add its default to `DEFAULT_SETTINGS` in `core.js` and a row to `SETTINGS` in `chrome.js`. Settings are free-form on the server.

## Code rendering (`app/code.js`)

Three entry points share one renderer:

| Function | Renders | Used by |
|---|---|---|
| `renderPage(el, pid)` | A full page: band, title, badges, why, comments, code | The Page level in every view |
| `renderNode(el, pid)` | Comments and code only | The focused card at the Core level |
| `renderFile(el, pids)` | A whole file as titled `<section class="sec" data-pid>`s, nothing folded | Diff's viewers |

Details:
- **Highlighting**: highlight.js runs on a whole block, so multi-line strings and comments colour correctly, and the result is then split per line. The language comes from the file extension.
- **Word diff**: within each run of removed lines followed by added lines, lines are paired in order and diffed token by token (LCS). The differing ranges get `--add-word` / `--del-word` highlights, unless most of the line changed, since whole-line changes read better without marks.
- **Folding**: a hunk that only adds or only removes lines (and untouched-code snippets) starts folded. `app.page.open` tracks what's unfolded.
- **Context**: `app.page.exp` grows the lines shown around a hunk (12 per click, 10 per `e`). It's fetched from `/api/file` and cached per path. It needs `caps.files`.
- **Comments**: drafts and `graph.discussion` entries are matched to lines by `path`, `line` and `side`. A line's `data-indiff` says whether a comment there can be inline on GitHub.
- **Events**: one delegated click and keydown listener per container (`bind`). Re-rendering goes through a stored `rerender` closure, so state changes in place.

`startComment(app, el)` and `expandAll(app, el)` back the `c` and `e` keys. They act on `app.pageEl`, which views set to whatever container currently shows the focus's code.

## Views

A view is an ES module in `app/views/` registered in `app/views/index.js`. The contract is in [SPEC.md › Writing a view](../SPEC.md#writing-a-view): `{ id, name, hint, mount(el, app) → { update(reason), destroy(), keys? } }`. Views inject their own CSS once with `injectCss(id, css)` (exported by `flow.js`) and use the theme's CSS variables.

All four canvases follow the same pattern: a `.stage` (viewport, receives input) containing a `.world` (absolutely positioned content, moved by one CSS `transform` for pan and zoom). Edges are an SVG inside the world, so they move with it.

### Flow (`flow.js`)
Lays out cores as rows and bands as columns. Degree-of-interest sizing: the focus is large, its neighbours medium, the rest small, and bands longer than a threshold fold into "+N". `camera()` frames the whole graph, the current core or the focus, depending on the level. Edges are cubic curves. Ones touching the focus are highlighted, ones outside the current core are dimmed, and edges to folded nodes route to the "+N" card.

### Outline (`outline.js`)
A rail rendered from the walk, with indentation from tree depth and distant cores folded. A document pane re-renders only when its key (`level:core` or `level:pid`) changes.

### Lens (`lens.js`)
A three-column grid: incoming neighbours, the focus, outgoing neighbours. Edges are redrawn with `wire()` on resize.

### Diff (`diff.js`)
The most involved view.

- **Model.** Every node's first placement in walk order is its canonical section. Sections are grouped by file (a change node's file, or a context node's path) and sorted by line. A file's column is the band of its most central section. `rel` maps each section to its related sections, from `graph.edges` mapped onto canonical sections, with a direction relative to that section. `pairs` lists each relation once.
- **Layout.** Every viewer is rendered with `renderFile`, measured (height capped at 460px) and stacked in band columns. Dragged viewers keep their position in `placedBy`.
- **Engagement.** `engaged` is true once the reader clicks into a viewer's code or steps with `j`/`k`. It's false after a background click (not a drag) or at Overview, and `.dv.engaged` mirrors it. Wheel events scroll code only over the active viewer while engaged; everywhere else they pan.
- **Reading focus.** A scroll in the active viewer, after 90ms, makes the section under the top third the focus (`readFocus`). Programmatic scrolls set a `quietUntil` window so they aren't read back as the reader moving.
- **Weights.** Each redraw gives every viewer `w-focus` (the active viewer and the targets of its focused edges, only while engaged), `w-semi` (other changed files) or `w-none` (untouched files). The CSS maps these to opacity and lift.
- **Follow.** When the focused edges change, other viewers smooth-scroll so the other ends are visible. The file you're reading is never scrolled for you.
- **Edges**, drawn by `draw()` once per animation frame:
  - *Read pass*: every viewer's scroll window and every anchor's position is read before anything is written, so the browser lays out once per frame.
  - *Focused edges*: from the active viewer's visible sections, with arrows pointing downstream and labels.
  - *Background edges* (`background()`): every other pair, at low opacity. If both ends are visible, the pair gets its own line. If an end is scrolled out of view it would pin to the viewer's border, so edges sharing both ends merge, with stroke `1.5 + ln(n)` px and a hover title. Past `BG_CAP` (300) pairs, lines go file to file between headers. The `edges: "focus"` setting skips this.
  - *Write pass*: shapes are reconciled by a stable key against `drawn`. Existing paths only get a new `d`. New background paths fade in, and removed ones fade out over 260ms. The background layer is drawn under the focused one.
- **Focus mode** (level 2). One file in a large viewer, with rails listing what its visible sections rely on and affect.
- **Input.** The header drags a viewer; the background drags the camera; `ctrl`+wheel or Safari gesture events zoom; two-finger touch pans and zooms. Mouse presses that start a drag call `preventDefault` so they don't select text.

## Styling (`app/theme.css`)

Design tokens live on `[data-theme="dark"]` and `[data-theme="light"]`: surfaces, lines, text levels, the single `--signal` amber, risk and ok colours, diff tints, and syntax colours. `--dur` and `--ease` drive every transition. `[data-motion="off"]` sets `--dur: 0` and disables all transitions and animations.
