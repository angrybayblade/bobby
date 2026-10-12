# Reviewing a PR

Bobby turns a PR into a short sequence of focused pages. You read one thing at a time, in an order where nothing appears before what it depends on.

## The walk

A PR is split into **cores**: each core is one cohesive idea, such as "retry on 503" or "new audit log table". Around each core, related code is placed in five **bands**, and you walk them left to right:

```
untouched code it relies on → changed code it relies on → CORE CHANGE → changed code it affects → untouched code it affects
```

| Band | What it holds |
|---|---|
| **Relies on · untouched** | Existing code the core uses, shown so you know what it builds on. |
| **Relies on · changed** | Other changes in the PR that the core depends on. |
| **Core change** ◆ | The change itself. |
| **Affects · changed** | Other changes that exist because of the core, such as callers and tests. |
| **Affects · untouched** | Code the PR didn't touch but whose behaviour it can change. This is where bugs usually hide. |

Cores are ordered foundations first. After the last core you get a **Low-signal changes** page (lockfiles, generated files, whitespace-only hunks, collapsed by default) and then an **End** page.

Each stop on the walk is a **page**: a title, one sentence on why it matters, any comments, then the code. Changed code is drawn with a solid dot ●, untouched code with a hollow dot ○.

If the same code is relevant to two cores, you review it once. Later appearances are shown as "already seen" and skipped by `j`/`k`.

## Where you start

- **First time on a PR:** you start in the **easiest core**: the one with the least around it (fewest pages it relies on or affects), then the fewest changed lines. Cores linked to nothing are only used when every core is like that. You land on its first page at the Core level, with a toast saying why and what to look for. `esc` takes you to the overview.
- **Coming back:** you resume on the page and zoom level you were last on. If you've made progress or parked a thought, the welcome-back card shows first.

## Hooks: what to look for

Every core has a **hook**: one question to keep in mind while you read it, usually about what could break ("Do untouched callers still pass a string id?"). Claude writes them. The static tree gets a simpler one built from the code ("6 untouched places use `x`. Do they still hold?"). The hook shows when you step into a core, on Outline's core page, in the core-done recap, and in the back-after-a-while recap.

## Zoom levels

Every view has three levels. `enter` zooms in, `esc` zooms out.

| Level | Shows |
|---|---|
| **Overview** | The whole PR: its intent and every core. |
| **Core** | The core you're in. Only the focused page shows its code; everything else stays title and why. |
| **Page** | One page, full size. |

The breadcrumb bar shows where you are (`repo #n › core › page`) and the current level. Click any crumb to jump to that level.

## Moving around

| Key | |
|---|---|
| `j` / `k` (or space) | Next / previous page, in walk order |
| Arrows | Follow the view's shape: → / ← along edges to what this leads into / comes from, ↑ / ↓ within the column. In Lens ← / → move a dependency level and ↑ / ↓ move along the level; in Outline → / ← go to the first nested page / the parent and ↑ / ↓ move between rows. |
| `J` / `K` | Next / previous core |
| `shift`+`1` | Back to the entry point: the unreviewed core with the least around it, where every load starts |
| `n` | Next page you haven't reviewed |
| `m` / `M` | Private note on a line / your notes panel |
| `v` | Switch view (Flow → Outline → Lens → Diff) |
| `f` | Focus: what you're on fills the screen with its code (Flow, Lens and Diff: the card or file; Outline: the reading pane takes the full width). Again, or `esc`, to go back exactly as you were. |
| `g` | Full screen page for what you're on; again, or `esc`, to go back exactly as you were |
| `t` | File tree on the right: show or hide |
| `d` | Diff layout for every file: inline or split (old beside new). Also the **Inline / Split** switch under the header; a file's own button switches just that file. |
| `?` | All keys |
| `⌘K` / `Ctrl+K` | Command palette: search every command, core, file and page by name, then `enter` to run or jump. Each command shows its key, so it's also a way to learn them. |

"Next" always follows the same walk, so switching views never changes what comes next.

## Marking progress

| Key | |
|---|---|
| `a` | Looks good: mark reviewed and go to the next unreviewed page |
| `x` | Flag to come back to (press again to clear) |
| `F` | Next flagged page |
| `u` | Un-mark |
| **Viewed** (Diff) | Toggle one section viewed, without moving on. The **☐ Mark viewed** checkbox in a file's header (in Diff, Flow and Outline), or the one beside it in the file tree, marks or clears the whole file, and stays ticked while every page of it is viewed. |

The header shows progress through the core you're in (`core 3 ▬ 2/5`) next to the whole PR (`12/40`, with a rough time left).

**Finishing a core** gets a short recap: pages, flags and notes from that core, how many cores are done, and the next core with its hook.

**Two passes.** For a big core, skim first: at the Core level every page is a title and a why, so step through with `j` and press `x` on anything worth a closer look. Then press `F` to jump between flagged pages for the deep read.

Marks are stored by the **content** of each hunk, not its position. After a force-push, hunks that didn't change stay reviewed, and only new or changed code comes back.

## Reading code

- Hunks that only add or only remove lines, and untouched code, start **collapsed**. Click one, or press `e`, to open it.
- Press `e` again for **more context**: 10 more lines above and below each hunk. This needs a local clone.
- Changes are shown with muted line tints and word-level highlights.

## Comments

1. Click a line to select it, then click it again (or press `c`) to open the composer. Pressing `c` with nothing selected picks the most relevant line on the page.
2. Write your comment. `cmd/ctrl+enter` saves it as a **draft**, and `esc` cancels.
3. Drafts show on their page and in a **"N drafts · S"** pill in the header. Delete one with its ✕.

**Existing review comments** on the PR are hidden by default, so the code comes first. A page with some shows **Show N comments from the PR**; click it to see them next to your drafts, on the lines they're anchored to, and click a comment to jump to its line. Lines with comments still carry a ◂ marker. To always show them, set **PR comments** to "Always shown" in settings. Your own drafts and private notes are always shown.

Comments on **untouched code** can't be inline on GitHub. They're kept as drafts and go into the review summary under "Notes on code this PR doesn't touch".

## Private notes

Notes are for you: reminders, questions to come back to, half-formed thoughts. **They're never posted to GitHub**, and they're kept in your local state file for this PR.

| Where | How |
|---|---|
| On a line | Select a line and press `m`. Or open the composer as for a comment and switch it to **Private note**; the choice sticks for the next one. |
| On a whole file | In the Diff view, click ✎ in the file's header. File notes show at the top of the file, and on its pages in every view. |
| On the whole PR | Press `M`, or click **✎ Notes** in the header, and write in the panel. |

The **Notes** panel (`M`) also lists every note on code. Click one to jump to its page. Notes look like comments but quieter (dashed, muted), and the composer is dashed while it's in note mode. Delete a note with its ✕.

## Submitting

Press `s`. Add an optional summary, then choose **Comment**, **Approve** or **Request changes**. Only drafts are posted; private notes and viewed marks stay local. All drafts are posted together as one GitHub review on the PR's current head commit, and you get a link to it. Drafts are cleared only once GitHub accepts the review.

## Staying focused

- **Park a thought (`p`).** Before you get pulled away, jot down what's in your head. It shows as a 📌 in the breadcrumb bar and on the welcome-back card.
- **Welcome back.** Every load starts at the **entry point**, the unreviewed core with the least around it, at the Core level. When you've made progress on the PR, a card shows where you were, your progress, flags, drafts and your parked thought: `enter` starts at the entry point, "Back to where you were" jumps there, and "See the overview first" zooms out. `shift`+`1` goes back to the entry point at any time.
- **Drift prompt.** After 90 seconds without input on a page, a small box asks where your head is. Type a line and press `enter` to park it, or ignore it. One prompt per page visit; it can be turned off in settings.
- **Back after a while.** After more than 8 minutes away (tab hidden or no input), a recap shows the page you were on, the two before it, your parked thought, and the core's hook.
- **Rabbit-hole nudge.** After 12 active minutes on one page (configurable, or off), it asks whether you're still in the right place: **Flag & move on**, or **Keep going**. Once per page visit.
- **Break reminder.** Opt in from settings (15, 25 or 45 minutes). It counts only active time, with the tab visible and recent input, and nudges once per period without blocking anything.
- **Key hints** at the bottom fade once you've used a key five times.

## The two trees

The **static tree** comes from static analysis: deterministic, instant, one core per changed symbol cluster. **Claude's tree** groups the same code into fewer, meaningful cores, with better titles, "why"s and risk marks. Claude can only use code that static analysis found, so it can't invent references.

While Claude works, the header shows "Claude is organising…". When it's ready, press `R` (or click the pill) to switch. You stay on the same code. Claude's tree is cached per head commit, so it's ready immediately next time.

Next: [Views](views.md) · [Settings](settings.md).
