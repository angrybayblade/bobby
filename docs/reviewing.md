# Reviewing a PR

prfocus turns a PR into a short sequence of focused pages. You read one thing at a time, in an order where nothing appears before what it depends on.

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
| `j` / `k` (or arrows, space) | Next / previous page |
| `J` / `K` | Next / previous core |
| `n` | Next page you haven't reviewed |
| `m` / `M` | Private note on a line / your notes panel |
| `v` | Switch view (Flow → Outline → Lens → Diff) |
| `?` | All keys |

"Next" always follows the same walk, so switching views never changes what comes next.

## Marking progress

| Key | |
|---|---|
| `a` | Looks good: mark reviewed and go to the next unreviewed page |
| `f` | Flag to come back to (press again to clear) |
| `u` | Un-mark |
| **Mark viewed** (Diff) | Toggle one section viewed, without moving on. ✓ in a file's header marks or clears the whole file. |

The header shows progress (`12/40`) and a rough estimate of the time left.

Marks are stored by the **content** of each hunk, not its position. After a force-push, hunks that didn't change stay reviewed, and only new or changed code comes back.

## Reading code

- Hunks that only add or only remove lines, and untouched code, start **collapsed**. Click one, or press `e`, to open it.
- Press `e` again for **more context**: 10 more lines above and below each hunk. This needs a local clone.
- Changes are shown with muted line tints and word-level highlights.

## Comments

1. Click a line to select it, then click it again (or press `c`) to open the composer. Pressing `c` with nothing selected picks the most relevant line on the page.
2. Write your comment. `cmd/ctrl+enter` saves it as a **draft**, and `esc` cancels.
3. Drafts show on their page and in a **"N drafts · S"** pill in the header. Delete one with its ✕.

**Existing review comments** on the PR are shown next to your drafts, on the lines they're anchored to. Click a comment to jump to its line.

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
- **Welcome back.** When you reopen a PR you've made progress on, a card shows where you were, your progress, flags, drafts and your parked thought. `enter` continues; "See the overview first" zooms out.
- **Break reminder.** Opt in from settings (15, 25 or 45 minutes). It counts only active time, with the tab visible and recent input, and nudges once per period without blocking anything.
- **Key hints** at the bottom fade once you've used a key five times.

## The two trees

The **static tree** comes from static analysis: deterministic, instant, one core per changed symbol cluster. **Claude's tree** groups the same code into fewer, meaningful cores, with better titles, "why"s and risk marks. Claude can only use code that static analysis found, so it can't invent references.

While Claude works, the header shows "Claude is organising…". When it's ready, press `R` (or click the pill) to switch. You stay on the same code. Claude's tree is cached per head commit, so it's ready immediately next time.

Next: [Views](views.md) · [Settings](settings.md).
