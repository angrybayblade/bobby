# Views

There are four views of the same review, plus the PR's conversation and a map of how it changes behaviour. Switch with `v` or the toggle in the header. Your focus, progress and comments are shared between them. A review opens in Diff the first time; after that, in the last view you used. The address bar follows you: `…/diff/src/app.ts#L42` is that file's viewer in Diff, `…/flow/src/app.ts#L42` that step in Flow, `…/conversation` the conversation. Reload, bookmark or share it to come back to the same place, and use back and forward to move between views.

| View | Shape | Good for |
|---|---|---|
| [Conversation](#conversation) | The PR as GitHub's Conversation tab shows it | The intent and the discussion, before or after the code; replying |
| [Map](#map) | A diagram of what the system does, before and after | Understanding what the change does, before reading its code |
| [Flow](#flow) | Node-link canvas, left to right | Seeing the shape of the change |
| [Outline](#outline) | Document rail and a reading pane | Big PRs, reading first |
| [Lens](#lens) | The focus in the centre, its neighbours either side | Maximum focus |
| [Diff](#diff) | One diff viewer per file, laid out as a graph | Reading real diffs without losing the thread |

A **file tree** on the right lists the PR's files as folders, like GitHub's: +/− counts, ◂ comments and notes, ✓ once a file's pages are all reviewed, and the file you're on highlighted. Each file is tagged with its level in the change tree of the core you're on: **L0** for the core change's file, **L1**, **L2**… for what it affects, **L-1**… for what it relies on; a file outside the current core shows its own closest level, faint. Click a file to go to its first unreviewed page, its checkbox to mark the whole file viewed, filter by name, fold folders, and toggle the whole panel with `t` or the panel icon in the top bar. ⇄ in its header (or the *File tree side* setting) moves it to the left or right. Each node remembers where you'd scrolled to in its code, as a card and as a page (and in Diff's viewers and a file's details), so stepping away and back picks up where you left it; a node you haven't read yet opens at its section, or stays put if that's already in view. Three switches in the top bar apply to every view: **Tests** (the flask, `T`; test files, hidden by default), **Generated** (the wand, `G`; generated files, hidden by default) and **Untouched** (the dashed circle, `U`; untouched code the changes rely on or affect). Point at any top-bar icon for what it does and its key. All views share the three zoom levels (Overview → Core → Page) described in [Reviewing](reviewing.md#zoom-levels), the same compact, GitHub-like code, and the same keys: `f` focus mode, `g` details, `esc` back exactly as you were, and arrows that follow the view's shape (edges in Flow, Lens and Diff; the tree in Outline). Double-click a file to get as close to it as you can: in Diff, its viewer zoomed in as far as it goes, at the top of the stage and centred (`d`, fit, does the same for the file you're on); in the other views, its page.

## Conversation

The PR as it reads on GitHub, top to bottom: its description, then comments, reviews and pushes in the order they happened, a box to comment, and where it stands. A PR only: a local branch review has no Conversation view.

- **Reviews** show their verdict (approved, changes requested, reviewed) and text, with the threads they started on code beneath, each showing the lines it's on (as they were when it was written, the commented ones marked) above its comments. Resolved and outdated threads start collapsed; click a thread's header to open or close it. **Resolve conversation**, beside **Reply…**, resolves a thread on GitHub (or **Unresolve conversation** reopens it), and the other views follow. Your own comments, on the PR and in threads, have **Edit** and **Delete** (twice, to be sure). **View code →** opens that code in the Diff view, in its file's viewer.
- **Replying.** *Reply…* under a thread and *Comment* at the end post at once, as GitHub's buttons do (`⌘`/`ctrl`+`enter` too). *Review changes…* opens the usual submit, for your drafts on lines and approving or requesting changes.
- **Status**, at the end: each reviewer's latest verdict and who's still asked; the head commit's CI checks, failing and running first, the rest folded, each with its time and a link to its run; and whether it can merge.
- It's read from GitHub when you open it and every 30 seconds after, and never redrawn under a box you're typing in. `j`/`k` step from item to item.

## Map

How the PR changes what the system does, as a diagram you read before the code: who does what, what calls what, what's read and written, before the change and after it. Claude draws it on request (**Draw the map**), from the PR and the code around it, read-only, as it does for a review; it's kept for the PR's head commit, and offers a redraw once the PR has new commits.

- **Scoped, then layered.** Claude first works out what the PR changes and who or what that affects, then defines the layers of abstraction this PR is best read at, its own for each PR: an overview in plain words (a request's steps, a user's way through a flow, a pipeline), then each layer opening up the part above where the change is, down to functions and data. A small fix may have one layer, a far-reaching change three or four. The layers work like Diff's zoom: the crumbs under the header are the path down to the layer you're on, and the bars at the right of that bar are the layers, one each, lit up to yours ("Layer 2 of 4"). Click a bar (its tooltip names it) or a crumb, or `enter` / `esc` to go a layer deeper or higher.
- **Before and after, inline or split**, with the same **Inline / Split** switch as Diff, at the right of the crumb bar (or `l`). *Inline*: one diagram whose parts are marked **same**, **added**, **removed** or **changed**, laid out once, with a slider from **Before** to **After**: what the PR removes fades out, what it adds fades in, and a changed part's label and points turn from what they were into what they are, while nothing moves (in the crumb bar; click either end, or `←` / `→`). *Split*: before and after side by side, each laid out on its own, panning and zooming together.
- **Read top to bottom.** Each part sits below what leads to it; an edge's label has a place of its own in the row under where it leaves, and a long edge goes round the parts in its way, so nothing is drawn over anything else (`views/maplayout.js`). It's drawn on a canvas, fitted to it at first: drag or scroll to pan, pinch or `ctrl`+scroll to zoom around the pointer, or use the − / + in the corner (the percentage between them fits it again).
- **Drawn plainly**: one ink, no colour for what's added, removed or changed (before and after show that). Hover a part for a note on what it does; click it to open its code in the code viewer, as the links in a change do.

## Flow

The whole PR as one free-flowing tree on a canvas, reading left to right: **this PR** → its **concerns** → a concern's **core changes** → what each affects → what that affects → ….

- **The tree is the review graph's own.** Each core change is a root, and every page hangs off the one page its core's edges attach it to. Code that several changes reach appears under each of them: the original once, the rest as small ↺ repeats you can click through.
- **Laid out in pre-order.** The level runs left to right; a parent shares its first child's row and each further child starts on the next free row, so reading down a level follows the tree depth-first.
- **Zoomed out** (Overview), you see the PR and its concerns: each a card with its module, its lead change, how many core changes it holds and your progress. **Zoom into a concern** (click it, or move into it at the Core level) and its core changes' trees open; the other concerns stay single cards.
- **What a core change relies on** sits to its left, on the row of what each card feeds (*relies on · changed*, then *relies on · untouched*). The top bar's **○ Untouched** switch hides untouched code on both sides: what the changes rely on and what they affect.
- **Concerns are grouped by module** for now: the deepest folder level (below what every file shares) that gives at most 15 groups, with a core change that's alone in its module joining the one it shares the most code with. Claude-made concerns can replace this later.

- Nodes are **sized by relevance**: the focus is big, its first few neighbours are medium, and the rest are small and sit back. Long lists of children fold into "+N", always keeping the path to the focus.
- Each card says how it relates in its own text ("Uses `retryMethods` and was changed too"); the band is a chip on it.
- At **Core**, the focused card shows its comments and code. At **Page**, the page takes over the stage.
- The camera glides between levels. Drag the background or scroll to pan, pinch or `ctrl`+scroll to zoom. Click a node to focus it, click it again to zoom in, and click "+N" to unfold. At **Core** the camera frames the focus and what it links to.
- Arrows follow the tree: → its first child, ↑ / ↓ the previous or next page at the same level, in pre-order. With nothing that way in the tree, they go to the nearest card that way on the canvas, a concern included.
- ← always retracts: to the parent (from a core change, to what it relies on), and from a tree's root out a level: a page to its node view, a node to its concern at the Overview.
- At the **Overview**, ↑ / ↓ step through the concerns, marking the one you're on, and → opens it.
- At **Core**, the focused card holds a file viewer like the Diff canvas's: the file's header (path, band, +/−, ✓ viewed, inline/split, ✎ note, ⤢ details), a sticky section heading with its **Viewed** box, and the same compact code. The card is as wide as a Diff viewer and framed to fill the stage, its code scrolling inside.
- `f` fills the canvas with the focused card and its code at a reading size; scrolling reads its code, and `j`/`k` keep it filled.

## Outline

A rail on the left lists the cores in order, with the open core as a tree: each page nested under the page it attaches to, so it reads core → what it affects → what that affects, and core ← what it relies on ← what that relies on. The band and the relation show where they change, long lists fold per direction, and distant cores are folded. The pane on the right shows:

- at **Overview**: the PR's story (intent and cores);
- at **Core**: the current core's story;
- at **Page**: the code page.

At **Core**, the focused step's code is a file viewer like Diff's (file header with ✓, inline/split, note and details; sticky section heading with its **Viewed** box; compact code), with no tint around it. Click any entry in the rail to focus it, or a core's heading to jump to its first unreviewed page. `f` hides the rail so the reading pane takes the full width.

## Lens

The focused page sits dead centre. What it relies on fans in from the left, and what it affects fans out to the right. Everything else is hidden. Walking re-centres the lens. At **Core**, the centre card shows the focus's comments and code. Click a neighbour to step to it. `f` gives the centre card the whole stage. ← / → move a dependency level (what the focus relies on / affects); ↑ / ↓ move to the previous / next page at the same level, its distance from the core change. At the root (the core change), ↑ / ↓ switch the lens to the previous / next core; on the Overview's grid, the arrows move between cores.

## Diff

A canvas with one scrollable diff viewer per file, laid out as a graph: each file sits one column to the right of the files that lead into it, so a chain a → b → c reads left to right, even when all three are in the same band. The band (relies on · untouched, core, affects · changed, …) is a label in the file's header, taken from its most central code. Files that are linked to each other form a group, headed by the cores it contains; files linked to nothing sit in a grid at the end. Each viewer shows the file's sections: the pages of the walk that live in that file, in line order. A viewer takes the stage's proportions (the space left after the bars and the file tree), so framing one at the Core level fills the stage with an even margin all round; a file with less to show is only as tall as its changes, centred. Resizing the window, or showing, hiding or moving the file tree, re-measures them.

**Reading.** Click into a viewer's code to be *in* it. From then on the wheel scrolls its code, and the section under its top third becomes your focus. `j`/`k` also put you in the viewer and scroll it for you. Clicking another file's code moves you there. Clicking the background (without dragging) or zooming out to Overview lets go.

**What stands out.** Viewers have three weights, so you can tell at a glance what you're looking at:

| Weight | Which viewers | Looks |
|---|---|---|
| Focus | The viewer you're in, plus the files its edges reach | Full strength and lifted, with their code |
| Semi-focus | Other changed files in the current core (at the Overview, all changed files) | Code hidden, 85% |
| Background | Untouched files, and at the Core level changed files from other cores | Code hidden, 60% |

Once you're in a viewer (you clicked it, or stepped into it with `j`/`k`), everything outside Focus keeps its place, size and title bar (file name, band, counts), but its code fades into the background, and the faint background lines go. The hidden code isn't drawn at all, so moving between files doesn't re-lay out or re-render the canvas. What's left showing code is what bears on the file you're reading. Click the background, or zoom out to the Overview, to bring every file back. Until you're in a viewer, every file shows its code: changed files at full strength and untouched ones at 50%. Hover a dimmed viewer to bring it up.

**Edges.**
- The sections visible in the file you're reading get **full edges**, with arrows and labels, to related sections in other files. Those files scroll to bring the other end into view.
- Every other relationship is a **faint background line**, so you can see the shape of the PR. Hover one to see what it connects and how.
- When a background line's end is scrolled out of view, lines that share both ends **merge** into one thicker line. Hover it for the count, for example "3 relationships scrolled ↓ in sealing.ts".
- Past 300 relationships, background lines are drawn once per pair of files, header to header.
- Background lines can be turned off in settings ("Diff edges: Focused only").

**Arrow keys.** In Diff the arrows move between files instead of walk pages (`j`/`k` still walk):
- **← / →** go back and forth through the files you've had in focus, like a browser's back and forward: every file you moved to, by any key or a click, lands on the section you were reading. Moving to a new file after going back drops what was ahead. With nothing more that way, they move along the layout instead (as below), and that step is kept in the same direction, so going back past the start carries on back and → retraces it. The history is kept in your browser per PR, so after a reload ← goes back to where you were last.
- **Shift + → / ←** move along the layout: → follows an edge to a file this one leads into, ← to a file that leads into it, picking the nearest; with no edge that way, the nearest file in the next column.
- **↑ / ↓** (with or without Shift) move to the file above or below in the same column.

Every move, these included, is added to the history; ← / → themselves just walk it.

**Moving around the canvas.**

| Gesture | |
|---|---|
| Drag the background | Pan |
| Pinch (trackpad), or `ctrl`+scroll | Zoom around the pointer |
| Two-finger scroll | Pan, except over the code of the viewer you're in, which scrolls |
| Two fingers on a touchscreen | Pan and zoom, even over code |
| Drag a viewer's header | Move the viewer (kept until you reload) |
| Click a header | Make that file the one you're reading (drag the header to move it instead) |
| `d` | Fit the file you're on: as wide as it goes, its top at the top of the stage (`d` again goes back) |
| `f` | Focus: the file you're on fills the stage |
| Double-click a header, ⤢, or `g` | Details: that file on its own (`g` again, or `esc`, goes back) |
| **☐ Mark viewed** in a header | Mark the whole file viewed (or clear it); it stays ticked, in green, while every page of the file is viewed |
| ✎ in a header | Private note on the whole file |
| **Viewed** on a section | Mark that section viewed (or clear it) |
| `f` (focus) | Fill the screen with the file you're reading: edge to edge across the canvas, its top edge at the top, and down to the bottom: the viewer keeps its width, takes the canvas's proportions, and is zoomed to fill it, while its contents are scaled back down so code stays at a reading size and long lines fit. It becomes the file you're reading, and any scroll on the canvas scrolls its code; zooming or dragging ends the fill. Moving to other files stays filled and aligned the same way. Again, or `esc`, to go back to the canvas as it was (on the file you're on, if you moved). From a page, returns to the canvas. |

Code in Diff is compact, like GitHub's diff: one box per file, slim hunk rows and a tight gutter, a size smaller on the canvas and the page alike. `l`, or the **Inline / Split** switch in the bar under the header, switches every file between an **inline** diff and a **split** one, old code beside new, with long lines wrapped so both sides stay level; viewers widen in split layout. A file's own ◫ / ▤ button (and **Split** / **Inline** on a file's code header in the other views) switches just that file, until the global layout changes. Pinch or `ctrl`+scroll to zoom a viewer up to a comfortable reading size; moving around keeps that zoom.

**Zoom levels in Diff.**
- **Overview:** all files fit on screen.
- **Core:** the camera frames the file you're reading.
- **Moving the focus** (arrows, `j`/`k`, a click) keeps your zoom. At the Core level the camera pans to centre the new file; at the Overview it only pans if the file is off screen. Changing level frames the view afresh, except coming back from a page: that returns the canvas exactly as you left it.
- **Page:** focus mode. The file fills the stage, and two side rails list what its visible sections **rely on** and **affect**. Click a rail card to go there. ⤡ or `esc` goes back to the canvas as you left it, zoom and pan included.
