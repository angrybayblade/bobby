# Views

There are four views of the same review. Switch with `v` or the toggle in the header. Your focus, progress and comments are shared between them, and the last view you used is remembered.

| View | Shape | Good for |
|---|---|---|
| [Flow](#flow) | Node-link canvas, left to right | Seeing the shape of the change |
| [Outline](#outline) | Document rail and a reading pane | Big PRs, reading first |
| [Lens](#lens) | The focus in the centre, its neighbours either side | Maximum focus |
| [Diff](#diff) | One diff viewer per file, laid out as a graph | Reading real diffs without losing the thread |

All views share the three zoom levels (Overview → Core → Page) described in [Reviewing](reviewing.md#zoom-levels), the same compact, GitHub-like code, and the same keys: `f` focus mode, `g` full screen, `esc` back exactly as you were, and arrows that follow the view's shape (edges in Flow, Lens and Diff; the tree in Outline).

## Flow

The whole PR as one graph that reads left to right from the changes: **① core change** (every core change in the PR) → **1st order** (what they affect) → **2nd order** (what that affects) → …. Code that several cores share appears once. Every page hangs off a page one order before it, so a column is one order further from the changes: the flow starts at the highlighted core-change column and ends at the rightmost one. Other links show, dashed, around the focus. What the changes rely on isn't part of the flow: it sits in lanes to the left (*relies on · changed*, then *relies on · untouched*, which the top bar's **○ Untouched** switch hides), each card beside the page it feeds. A root card names its core.

- Nodes are **sized by relevance**: the focus is big, its first few neighbours are medium, and the rest are small and sit back. Long lists of children fold into "+N", always keeping the path to the focus.
- Each card says how it relates in its own text ("Uses `retryMethods` and was changed too"); the band is a chip on it.
- At **Core**, the focused card shows its comments and code. At **Page**, the page takes over the stage.
- The camera glides between levels. Drag the background or scroll to pan, pinch or `ctrl`+scroll to zoom. Click a node to focus it, click it again to zoom in, and click "+N" to unfold. At **Core** the camera frames the focus and what it links to.
- Arrows follow the flow: → one order deeper (the first page reached from this one), ← back toward the core change (and from it, to what it relies on), ↑ / ↓ the page above or below in the same column.
- `f` fills the canvas with the focused card and its code at a reading size; scrolling reads its code, and `j`/`k` keep it filled.

## Outline

A rail on the left lists the cores in order, with the open core as a tree: each page nested under the page it attaches to, so it reads core → what it affects → what that affects, and core ← what it relies on ← what that relies on. The band and the relation show where they change, long lists fold per direction, and distant cores are folded. The pane on the right shows:

- at **Overview**: the PR's story (intent and cores);
- at **Core**: the current core's story;
- at **Page**: the code page.

Click any entry in the rail to focus it, or a core's heading to jump to its first unreviewed page. `f` hides the rail so the reading pane takes the full width.

## Lens

The focused page sits dead centre. What it relies on fans in from the left, and what it affects fans out to the right. Everything else is hidden. Walking re-centres the lens. At **Core**, the centre card shows the focus's comments and code. Click a neighbour to step to it. `f` gives the centre card the whole stage.

## Diff

A canvas with one scrollable diff viewer per file, laid out as a graph: each file sits one column to the right of the files that lead into it, so a chain a → b → c reads left to right, even when all three are in the same band. The band (relies on · untouched, core, affects · changed, …) is a label in the file's header, taken from its most central code. Files that are linked to each other form a group, headed by the cores it contains; files linked to nothing sit in a grid at the end. Each viewer shows the file's sections: the pages of the walk that live in that file, in line order.

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
- **→** follows an edge to a file this one leads into, and **←** to a file that leads into it, picking the nearest. With no edge that way, they go to the nearest file in the next column.
- **↑ / ↓** move to the file above or below in the same column.

**Moving around the canvas.**

| Gesture | |
|---|---|
| Drag the background | Pan |
| Pinch (trackpad), or `ctrl`+scroll | Zoom around the pointer |
| Two-finger scroll | Pan, except over the code of the viewer you're in, which scrolls |
| Two fingers on a touchscreen | Pan and zoom, even over code |
| Drag a viewer's header | Move the viewer (kept until you reload) |
| Click a header | Make that file the one you're reading (drag the header to move it instead) |
| Double-click a header, ⤢, or `g` | Expand that file to full screen (`g` again, or `esc`, goes back) |
| ✓ in a header | Mark every section in the file viewed (or clear them) |
| ✎ in a header | Private note on the whole file |
| **Viewed** on a section | Mark that section viewed (or clear it) |
| `f` (focus) | Fill the screen with the file you're reading: edge to edge across the canvas, its top edge at the top, and down to the bottom: the viewer keeps its width, takes the canvas's proportions, and is zoomed to fill it, while its contents are scaled back down so code stays at a reading size and long lines fit. It becomes the file you're reading, and any scroll on the canvas scrolls its code; zooming or dragging ends the fill. Moving to other files stays filled and aligned the same way. Again, or `esc`, to go back to the canvas as it was (on the file you're on, if you moved). From a page, returns to the canvas. In Diff `f` focuses rather than flags; flag from another view. |

Code in Diff is compact, like GitHub's diff: one box per file, slim hunk rows and a tight gutter, a size smaller on the canvas and the page alike. `d`, or the **Inline / Split** switch in the bar under the header, switches every file between an **inline** diff and a **split** one, old code beside new, with long lines wrapped so both sides stay level; viewers widen in split layout. A file's own ◫ / ▤ button (and **Split** / **Inline** on a file's code header in the other views) switches just that file, until the global layout changes. Pinch or `ctrl`+scroll to zoom a viewer up to a comfortable reading size; moving around keeps that zoom.

**Zoom levels in Diff.**
- **Overview:** all files fit on screen.
- **Core:** the camera frames the file you're reading.
- **Moving the focus** (arrows, `j`/`k`, a click) keeps your zoom. At the Core level the camera pans to centre the new file; at the Overview it only pans if the file is off screen. Changing level frames the view afresh, except coming back from a page: that returns the canvas exactly as you left it.
- **Page:** focus mode. The file fills the stage, and two side rails list what its visible sections **rely on** and **affect**. Click a rail card to go there. ⤡ or `esc` goes back to the canvas as you left it, zoom and pan included.
