# Browser runtime

The UI in `public/` is plain ES modules with no build step and no framework. `index.html` lays out five regions: `#top` (header), `#where` (breadcrumbs), `#view` (the active view), `#keys` (key hints), plus `#overlay` and `#toast`.

## Boot (`app/main.js`)

1. Fetch `/api/graph` and `/api/session` in parallel, and create the runtime with `createApp`. If either fails, the loading line says why and boot stops.
2. Attach the rendering helpers to `app` (`renderPage`, `renderNode`, `renderFile`).
3. Apply settings to the document: `data-theme`, `data-motion`, and CSS variables for font, size and word spacing.
4. Pick the starting focus: always `app.entryPoint()` (the unreviewed core with the fewest dependency pages, then the fewest changed lines, preferring linked cores) at the Core level. The stored `lastNodeId` is offered on the welcome-back card instead of jumped to. With nothing left unreviewed, the first page at Overview.
5. Mount the view: from the URL hash if present, otherwise the last one used (`settings.view`).
6. Start the tour module and the chrome. On a first launch (`/api/session` returned no saved settings), run the tour first; then show the welcome-back card if there's progress or a parked thought, or else the entry point's intro toast.
7. While Claude or a language server is working, poll `/api/status` every 3 s (every 10 s while the server can't be reached), toast when Claude's tree is ready, and emit `llm` only when a status actually changed.

**The address** says where you are: `/r/<id>/<view>`, then the step as `/<file path>#L<line>` (the line its first hunk or snippet starts on), and `?zoom=core` or `?zoom=page` only when the level isn't the view's usual one (a step's viewer in Diff, its page elsewhere). A view with no path is its overview; `~low-signal` and `~done` name the two pseudo-pages. Steps are named by file and line, not placement id, since ids change when Claude's tree replaces the static one; `pidAt` turns them back into a step. Boot reads it (a step it names wins over the entry point and the welcome-back card; one the review no longer has opens the overview, with a toast). Moving within a view rewrites it with `replaceState` (debounced 150 ms); `switchView` pushes, so back and forward go between views, and `popstate` applies the address without pushing. The server serves the page for any path under a review, and its API for `/r/<id>/api/…` only, so a file path can hold `api/`.

**Deep links for testing**: `#view=lens&level=1&p=5` picks the view, level and walk position (1-based), over the address. `window.bobby` exposes the runtime in the console.

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
| `comments` | A draft or private note was added, deleted or submitted |
| `graph` | `replaceGraph` swapped in Claude's tree (focus is kept by node id) |
| `settings` | A setting changed |
| `llm` | Claude's or a language server's status changed |
| `view` | You switched views (the chrome redraws; views don't get it, the new one was just mounted) |
| `resize` | The window resized (sent to the view by `main.js`) |

`main.js` forwards every reason to the mounted view's `update(reason)`.

**Private notes.** `addNote({ body, path?, line?, side? })` and `deleteNote(id)` keep `state.notes` in sync with the server and emit `comments`, since notes render wherever comments do. `pidAt(path, line)` finds the page that shows a file's line, for jumping to a note.

**Settings.** `settings` is `DEFAULT_SETTINGS` overlaid with the saved file. `saveSettings(patch)` updates it locally, POSTs the patch and emits `settings`. `useKey(k)` counts key uses so hints can fade.

## Keyboard (`app/main.js`)

One `keydown` handler. It ignores typing in inputs and any modified keys, leaves `enter` and space to a button or link you've tabbed to, and lets an open modal take `esc` (from its text box too) and `enter`. Every action has a stable id in `app/keys.js` (`ACTIONS`), with default keys the reader can rebind (`settings.keys`). `press(key)` looks up the key's action and `runAction(id)` runs it: the view's own `keys: { [id]: fn }` from `mount` win over the global `ACTS`. Every handled key calls `useKey`.

The one modified key is `⌘K` / `Ctrl+K`, which toggles the command palette (`app/palette.js`). It doesn't open over another modal or while you're writing in a textarea. The palette shows in `#overlay` like any modal and searches four kinds of item: commands, cores, files and pages. Commands come from `commands()` in `main.js`: every action in `ACTIONS`, run through `runAction(id, { learn: false })` so view keys like `f` and `g` do what they do in the current view, without counting toward fading their hints. There are also commands with no key of their own (switch to a view, theme). Cores, files and pages are read from the walk each time it opens, so the switches decide what it finds. Matching is per word against the title, then the subtitle (a file's folder, a page's core and path). Substrings beat scattered letters, and word starts count extra. With nothing typed, it lists what you ran last, then every command and core.

To add a command with a key, add an action to `ACTIONS` in `keys.js` and its handler to `ACTS` (or a view's `keys`); for one without a key, add it to `commands()`.

## Chrome (`app/chrome.js`)

Everything outside the view: the header (title, Claude status pill, progress, view switcher, drafts pill, settings), the breadcrumb bar (crumbs, parked thought, level dots), key hints per level, and modals (help, settings, submit, park, welcome back). Also toasts, plus the attention aids, which all run off one 10-second activity clock ("active" means the tab is visible and there was input in the last two minutes):
- the core intro (hook) on entering a new core, suppressed for 1.5s after a core-done recap;
- per-core progress in the header, and the core-done recap (`watchCores` on `marks`);
- the drift prompt (90s idle on a page), the back-after-a-while recap (over 8 minutes away, with a trail of the last few pages), the rabbit-hole nudge (`settings.rabbit` active minutes on one page) and the break reminder. It re-renders on `focus`, `level`, `marks`, `graph`, `settings`, `comments` and `llm`.

To add a setting, add its default to `DEFAULT_SETTINGS` in `core.js` and a row to `SETTINGS` in `chrome.js`. Settings are free-form on the server.

## Tour and what's new (`app/tour.js`)

A callout is a card plus a ring around what it points at (a CSS selector). The ring's oversized shadow dims the rest of the page but takes no clicks, and the main key handler gives the callout only `enter`, `esc` and `←`/`→`, so the app keeps working underneath. It follows its target as the app re-renders, and skips steps whose target isn't on screen.

- **Tour.** `TOUR` runs once, on a first launch, and sets `settings.tour` to `seen`. Anyone upgrading is marked seen without being shown it. `start()` replays it from the `?` sheet and the palette.
- **What's new.** `NEWS` lists one note per feature, oldest first. Each launch offers the first unseen one as a chip at the end of `#keys`. Opening it adds its id to `settings.news`. A first launch marks every note seen, since the tour covers the app as it is.

To announce a feature, append `{ id, title, body, act? }` to `NEWS`; `act: { label, run }` adds a button that does something, like opening the tour.

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
- **Comments and notes**: drafts, `graph.discussion` entries and line notes are matched to lines by `path`, `line` and `side`. A line's `data-indiff` says whether a comment there can be inline on GitHub. The line composer (`app.page.composing`, with `kind` set to `comment` or `note`) can switch kind without losing its text. File notes render at the top of `renderFile` and on page and card bodies, and their composer (`composing.file`) survives focus changes within the file.
- **Viewed toggles**: `renderFile` section headers carry a `data-viewed` button that toggles the review mark. Views keep `.sec.done` current, and CSS swaps the label.
- **Events**: one delegated click and keydown listener per container (`bind`). Re-rendering goes through a stored `rerender` closure, so state changes in place.

`startComment(app, el)` and `expandAll(app, el)` back the `c` and `e` keys. They act on `app.pageEl`, which views set to whatever container currently shows the focus's code.

## Views

A view is an ES module in `app/views/` registered in `app/views/index.js`. The contract is in [SPEC.md › Writing a view](../SPEC.md#writing-a-view): `{ id, name, hint, mount(el, app) → { update(reason), destroy(), keys? } }`. Each view mounts into its own slot inside `#view`. Switching away destroys a view, except Diff, which is costly to build and is kept alive: its slot is parked with `content-visibility: hidden` (not drawn, layout kept), `hide()` notes where you were, and on return `update("resume")` catches up on what changed elsewhere (focus, level, comments and notes, settings), rebuilding only if what its viewers are built from changed. Switching back to Diff is a repaint, not a rebuild; the cost is that its memory stays held while you're in another view. Views inject their own CSS once with `injectCss(id, css)` (exported by `flow.js`) and use the theme's CSS variables.

All four canvases follow the same pattern: a `.stage` (viewport, receives input) containing a `.world` (absolutely positioned content, moved by one CSS `transform` for pan and zoom). Edges are an SVG inside the world, so they move with it.

### Flow (`flow.js`)
The PR as one tree on a canvas, left to right: the PR, its concerns, each concern's core changes, then what each affects (what it relies on to its left), laid out in pre-order. Degree-of-interest sizing: the focus is large, its neighbours medium, the rest small, and bands longer than a threshold fold into "+N". `camera()` frames the whole graph, the current core or the focus, depending on the level. Edges are cubic curves. Ones touching the focus are highlighted, ones outside the current core are dimmed, and edges to folded nodes route to the "+N" card.

### Outline (`outline.js`)
A rail rendered from the walk, with indentation from tree depth and distant cores folded. The document pane re-renders on every update; its key (`level:core` or `level:pid`) decides whether the scroll position is kept (the same key) or reset.

### Lens (`lens.js`)
A three-column grid: incoming neighbours, the focus, outgoing neighbours. Edges are redrawn with `wire()` on resize.

### Diff (`diff.js`)
The most involved view.

- **Model.** Every node's first placement in walk order is its canonical section. Sections are grouped by file (a change node's file, or a context node's path) and sorted by line. A file's column is the band of its most central section. `rel` maps each section to its related sections, from `graph.edges` mapped onto canonical sections, with a direction relative to that section. `pairs` lists each relation once.
- **Layout.** Every viewer is rendered with `renderFile`, measured (height capped at what fits the stage at the Overview's scale, at least 240px) and placed by `layered()` (`views/layered.js`): files become a directed graph from the section edges, cycles are broken in band-then-walk order, each file's column is its longest path from a source, a few barycentre sweeps order each column, and heights line up with what leads in. Connected groups are stacked, and unlinked files go in a grid at the end. Dragged viewers keep their position in `placedBy`.
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
- **Camera.** `frame()` fits the view on a level change. `track()` handles focus changes at the current scale: it centres the active viewer at the Core level and only pans at the Overview if it's off screen.
- **Input.** The header drags a viewer; the background drags the camera; `ctrl`+wheel or Safari gesture events zoom; two-finger touch pans and zooms. Mouse presses that start a drag call `preventDefault` so they don't select text.

## Styling (`app/theme.css`)

Design tokens live on `[data-theme="dark"]` and `[data-theme="light"]`: surfaces, lines, text levels, the single `--signal` amber, risk and ok colours, diff tints, and syntax colours. `--dur` and `--ease` drive every transition. `[data-motion="off"]` sets `--dur: 0` and disables all transitions and animations.
