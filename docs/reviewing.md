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

Cores are ordered foundations first. After the last core you get a **Low-signal changes** page (lockfiles, generated files, whitespace-only hunks, binary files and renames without changes, collapsed by default) and then an **End** page.

Each stop on the walk is a **page**: a title, one sentence on why it matters, any comments, then the code. Changed code is drawn with a solid dot ●, untouched code with a hollow dot ○.

If the same code is relevant to two cores, you review it once. Later appearances are shown as "already seen" and skipped by `j`/`k`.

## Where you start

- **First time using Bobby:** a short tour points at the breadcrumbs, the walk, the views and the key hints, one at a time. It doesn't block anything: keys still work underneath, `enter` goes on, `esc` skips. It shows once; take it again from **Take the tour** in the `?` sheet or the command palette. After an update, new features show up one at a time as a **New** chip at the end of the key hints; click it to read about the feature, and it won't show again.
- **First time on a PR:** you start in the **easiest core**: the one with the least around it (fewest pages it relies on or affects), then the fewest changed lines. Cores linked to nothing are only used when every core is like that. You land on its first page at the Core level, with a toast saying why and what to look for. `esc` takes you to the overview.
- **Coming back:** every load starts at the entry point. If you've made progress or parked a thought, the welcome-back card shows first, with where you were, to jump back to.

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
| Arrows | In Diff, ← / → go back and forth through the files you've visited (Shift + arrows move along the layout); see [Views](views.md#diff). In Flow, → / ↑ / ↓ follow the tree (or the nearest card that way) and ← always retracts, to the parent and then out a level; see [Views](views.md#flow). In Lens ← / → move a dependency level and ↑ / ↓ move along the level; in Outline → / ← go to the first nested page / the parent and ↑ / ↓ move between rows. |
| `J` / `K` | Next / previous core |
| `shift`+`1` | Back to the entry point: the unreviewed core with the least around it, where every load starts |
| `n` | Next page you haven't reviewed |
| `m` / `M` | Private note on a line / your notes panel |
| `v` or `ctrl`+`.` / `ctrl`+`,` | Next view to the right / to the left (Conversation → Map → Lens → Outline → Flow → Diff, round again) |
| `ctrl`+`c` `m` `l` `o` `f` `d` | Straight to Conversation, Map, Lens, Outline, Flow or Diff (`ctrl`+`c` still copies while text is selected). Pointing at a view in the switcher shows its key. |
| `f` | Focus: what you're on fills the screen with its code (Flow, Lens and Diff: the card or file; Outline: the reading pane takes the full width). Again, or `esc`, to go back exactly as you were. |
| `d` | Fit (Diff): the file you're on, as wide as it goes with its top at the top of the stage, as a double-click in the file tree shows it. Again, before you pan or zoom, to go back. |
| `g` | Details: the page for what you're on, on its own with what it relies on and affects; again, or `esc`, to go back exactly as you were |
| `t` | File tree on the right: show or hide |
| `T` / `G` / `U` | Show or hide test files / generated files / unchanged code, in every view (the flask, wand and dashed-circle switches in the top bar) |
| `C` | Show or collapse every comment in the PR (the comments pill in the top bar) |
| `Q` | Review with Claude: its prompt, what it's doing, or its findings once it's done (the sparkles in the top bar) |
| `l` | Layout for every file, and Map's before and after: inline or split (old beside new). Also the **Inline / Split** switch under the header; a file's own button switches just that file. |
| `?` | All keys |
| `⌘K` / `Ctrl+K` | Command palette: search every command, core, file and page by name, then `enter` to run or jump. Each command shows its key, so it's also a way to learn them. |

"Next" always follows the same walk, so switching views never changes what comes next.

### Your own keys

Every key above is a default. To change one, press `?`, then **Customize keys** (or **Keyboard shortcuts…** in settings, or search "keyboard shortcuts" with ⌘K). Each action lists its keys: **+** binds another (press it; `esc` cancels), **✕** removes one, and **reset** puts back the defaults. A key already bound to another action moves to this one, and the editor says which action lost it. Key hints, the key sheet, the palette, the tour and Bobby's messages all show your keys. Esc still closes what's open first, whatever you bind it to; ⌘-click and ⌘K aren't rebindable.

## Marking progress

| Key | |
|---|---|
| `a` | Looks good: mark reviewed and go to the next unreviewed page |
| `x` | Flag to come back to (press again to clear) |
| `F` | Next flagged page |
| `N` | Next unresolved GitHub thread |
| `u` | Un-mark |
| **Viewed** (Diff) | Toggle one section viewed, without moving on. The **☐ Mark viewed** checkbox in a file's header (in Diff, Flow and Outline), or the one beside it in the file tree, marks or clears the whole file, and stays ticked while every page of it is viewed. |

The header shows progress through the core you're in (`core 3 ▬ 2/5`) next to the whole PR (`12/40`, with a rough time left).

**Finishing a core** gets a short recap: pages, flags and notes from that core, how many cores are done, and the next core with its hook.

**Two passes.** For a big core, skim first: at the Core level every page is a title and a why, so step through with `j` and press `x` on anything worth a closer look. Then press `F` to jump between flagged pages for the deep read.

Marks are stored by the **content** of each hunk, not its position. After a force-push, hunks that didn't change stay reviewed, and only new or changed code comes back.

**Viewed files follow GitHub's Viewed checkboxes.** When a PR opens, files you ticked on GitHub are marked viewed here. After that, a file that becomes viewed in Bobby (its last page marked, or **Mark viewed**), or stops being, ticks or clears its box on GitHub at once, so the two agree whichever you review in. A file ticked on GitHub that has changed since counts as not viewed, as it does there. Reviewing one commit of a PR, or a local branch, has no boxes to follow.

## Reading code

- Hunks that only add or only remove lines, and untouched code, start **collapsed**. Click one, or press `e`, to open it.
- Press `e` again for **more context**: 10 more lines above and below each hunk. This needs a local clone.
- Changes are shown with muted line tints and word-level highlights.

## Inspecting a name

⌘-click (ctrl-click elsewhere) a function, class, type or variable in the code to see where it's declared, in a window over the review: its file and line (with a link to GitHub), its type and doc comment, and its code, with the declaring line marked. ⌘-click a name inside the window to go deeper; the trail at the top goes back to any step. `esc` goes back a step and then closes it, as do ✕ and a click outside. While it's open, other keys wait. Holding ⌘ shows a pointer over code you can inspect.

⌘⇧-click (ctrl+shift-click) a name to list where it's used instead, file by file, each file marked **in diff** (uses on lines the PR shows), **in PR** (files it changes, on lines it didn't touch) or **elsewhere** (files it doesn't change, such as untouched nodes), in that order, the file you're in first. Each use is one line: its line number, where it sits (`RateLimiter › check()`, `it "rejects over the limit"`), and its code with the name marked. Chips at the top filter to a group, or to the **calls** or **imports**. Click a use (or ↑ ↓ and enter) to read its code in place, with more above or below on request; a use in the branch also gets **Open in diff** (or `o`), which focuses its diff node. Elsewhere shows up to 200 lines; filter to it for more. With a language server it finds every use; without one, it finds the uses that resolve through imports, and misses those reached through a value.

Hovering a name highlights every other use of the same symbol on screen, in any file: the same declaration, not just the same spelling, so a local `env` and an imported `env` stay apart. Names Bobby couldn't place aren't highlighted.

For TypeScript, JavaScript, Python and Go, a language server answers: it places locals, members of values (`client.get()`), and types. Bobby starts one per language in the review, in the background, and **<Language> types loading…** shows in the top bar until it's ready, usually seconds. One that isn't set up shows **<Language> types · set up?** (Bobby can install it: the card says what, how big, and from where, then **Install**, **Not now** or **Never**) or **needs setup** (for Go: the `go install` command to run, then **Check again**). Until a server answers, and for other languages, Bobby finds what imports and the syntax tree can. A name from a package says which package; packages aren't installed, so their own types aren't followed. Removed lines can't be inspected yet.

## Comments

1. Click a line to select it, then click it again (or press `c`) to open the composer. Pressing `c` with nothing selected picks the most relevant line on the page. For several lines, like GitHub's diff, click the first line, then shift-click the last (or drag down the line numbers): the comment or note covers the whole range, shows as `L12–L18`, and posts to GitHub as a multi-line comment. Selecting shows a small popover on the last selected line: **Comment** (a GitHub draft) or **Private note**. From the keyboard, `]` and `[` select the next or previous line, and `}` and `{` grow the selection, as shift-click does; then `c` or `m`.
2. The comment box opens where the comment will sit: under the line, the width of the file (in split, on that line's side). Switch it between **Comment** and **Private note** at the top. **Save draft** (or `cmd/ctrl+enter`) saves it; **Cancel** discards it; `esc` closes it and keeps what you wrote as an unfinished draft to **Continue** later. On new lines (the right side), **± Suggest change** puts a GitHub suggestion in the comment: the selected lines as they are, in a ```` ```suggestion ```` block, to edit into what they should be. GitHub then offers the author a button to commit it. Suggestions, yours and others', show as the lines as they are (−) and as suggested (+).
3. A draft shows under its line, like a comment, tagged **draft**, and counts in the **"N drafts · S"** pill in the header. Delete it there.

**Comments sit under the line they're on**, as on GitHub: the PR's existing comments, with their author's avatar, name and time, replies stacked under the first, Markdown rendered (code, tables, lists, links) and long ones cut short with **Show more**; and your drafts, the same way. A comment on a range sits under its last line. In the inline layout a thread is as wide as the file; in split, it's on the side it was made on (removed lines left, the rest right), as wide as that side. A comment just outside the lines a hunk shows is announced at its edge, **"2 comments below"**, which opens the code down to it. A thread resolved on GitHub is tagged **resolved** and starts collapsed, as on GitHub; click it to read it. **Reply…**, under an open thread, opens a box to answer in it; **Reply** (or ⌘↵, ctrl+enter) posts it to GitHub at once, as a reply in a thread does there, and esc closes the box, keeping what you wrote while the page is open. Your own comments already on GitHub have **Edit** (in place; ⌘↵ saves, esc cancels) and **Delete** (click it twice: GitHub can't undo it). Under each comment are its reactions, yours highlighted: click one to add yours or take it back, or the smiley for GitHub's eight. They're sent at once, as on GitHub, and the Conversation view has them too, on the description, comments and reviews. **Resolve conversation**, beside **Reply…**, resolves it on GitHub at once (it collapses), and **Unresolve conversation** undoes it; as on GitHub, only the PR's author and people with write access to the repo can. A thread whose line this diff no longer has (GitHub's *outdated*) can't sit in the code, so each file with any shows a line above its code, **"2 outdated threads on this file"**, which opens the first unresolved one in the [Conversation view](views.md#conversation).

**Collapsing** leaves a comment where it is, as one slim line with its author, how it starts and how many replies. Three levels, each a speech-bubble button that's filled while comments show and an outline while they're collapsed: a thread's own (in its corner, or click its header to collapse it and the slim line to open it), a file's (in the file's header, with its count), and the whole PR's (in the top bar, with its count). A broader one sets everything under it; a thread can still be opened or collapsed on its own afterwards. The PR's is saved as the **Comments** setting (open by default), and the rest last while the page is open.

**Unresolved threads** are counted in the top bar, **3 unresolved**, as GitHub counts them, outdated ones included. Click it, or press `N`, to go to the next one in walk order, opened and in view (an outdated one opens in the Conversation view); it wraps around. To see only what's still open, set **Resolved threads** to **Hidden** in Settings: resolved threads then leave the code and the counts.

Comments on **untouched code** can't be inline on GitHub. They're kept as drafts and go into the review summary under "Notes on code this PR doesn't touch".

## Claude's review (preview)

Claude reviews only when you ask. **Review with Claude** (the sparkles in the top bar) (or **Review with Claude…** in the command palette) opens a prompt: say what it should focus on ("Could this break existing API clients?"), pick from the suggestions (bugs and edge cases, callers, security, errors, concurrency, tests), or leave it empty for a general review; `⌘↵` starts it. Claude reads the diff, then checks the code around it at the PR's head: callers, definitions, tests. The prompt then shows what it's doing; close it and keep reviewing, as it usually takes a minute or two (or **Stop it**). The pill says **Claude is reviewing…** meanwhile, and when it's done, how many findings it has: that's the only notice, nothing pops up.

Click the pill to go through the findings one at a time, worst first; **New review…** at the top asks again, about something else. Each shows its tag (Bug, Risk, Question or Nit), where it is, the code it's about with its lines marked, and Claude's comment as it would be posted. Then:

| Key | |
|---|---|
| `a` | **Add to review**: it becomes a draft of yours, posted when you submit |
| `e` | **Edit first**, then `⌘↵` adds it as edited |
| `d` | **Dismiss** it (go back with `k` to bring it back) |
| `j` / `k` | Skip it for now / back |
| `o` | Show it in the diff |
| `esc` | Close |

Findings also sit on their lines in the diff as dashed suggestions, with the same Add to review and Dismiss. Nothing Claude writes is posted unless you add it and submit. Findings are kept with your review for that head commit; after new commits, **Review again**.

Claude runs in a copy of the head commit with only its read-only file tools (Read, Grep, Glob), none of your Claude Code settings or MCP servers, and can't read outside that copy. `BOBBY_REVIEW_MODEL` (else `BOBBY_MODEL`) picks the model.

## Asking Claude about code (preview)

Select some lines (click one, shift-click another) and press **✦** in the popover beside them, or `q`: the comment box opens as **✦ Ask**. Type a question, or click a starter (Explain what this does, What could break here?, Is this tested?, Review these lines); `⌘↵` asks. Claude reads the file's diff with your lines marked, checks the code around them (what they call, what calls them) in a read-only copy of the head commit, and answers there, on those lines, as it writes. While it works you see what it's reading; **Stop** stops it.

You can keep reviewing while Claude answers. If the answer arrives while it isn't on screen (you've moved to another page, collapsed it, or switched tabs), a notice in the bottom-right corner says so, with the question; **Show answer** takes you to it. The tab's title gets a ✦ while you're away.

Ask a follow-up under the answer: Claude has the conversation so far. **Comment from it** opens a draft comment on the same lines with the last answer in it, to edit before it's part of your review; **Save as note** keeps the questions and answers as a private note; **Delete** removes the conversation. Questions are kept with your review for that head commit, and only you see them.

### Claude's references, and what it can look at

When Claude cites code, in an answer, a finding or a review's summary, the reference is a link. Bobby checks each one against the commit's files and lines first, so every link opens real code; one that doesn't resolve stays text. A click opens it in the code viewer, the inspector's window: the cited lines marked, the lines the PR added highlighted (or, for code from before the PR, the ones it removed), more lines above and below on demand, ⌘-click a name to inspect it, and **Show in diff** (`o`) when the diff shows those lines. A finding you add to your review gets GitHub links instead, so they work once it's posted.

Besides its own Read, Grep and Glob on the PR's head, Claude gets Bobby's tools: the PR's overview and each file's diff, any file before or after the PR with the PR's changes marked, where a name is defined and used (the language servers, as the inspector), the review threads, and a line's history. A review reads the PR file by file with them, and each finding is reported once Claude has checked it. They're read-only, and only that run of Claude can reach them.

### Your own tools: Linear, Notion, Slack, Datadog…

Claude can also use your own Claude Code setup, for context the code doesn't have: the PR's ticket, a design doc, a Slack discussion, an alert. It's off until you choose, per MCP server or claude.ai connector (a plugin's MCP servers count as servers):

- **For every PR in this Bobby:** start it with `--agent-tools linear,notion,datadog:all` (or `BOBBY_AGENT_TOOLS`), each a part of a server's name.
- **For one PR:** **Your tools for this PR** in the **Review with Claude** dialog (or **Claude's tools for this PR…** in the command palette) lists what you have, each **Off**, **Read** or **All**. A change is kept with that PR; **Use the launch default** goes back. Questions about code use the same choice.

**Read** lets Claude use only a server's tools whose names read (`get_`, `list_`, `search_`…); anything that creates, sends, updates or deletes is blocked, so a PR can't get Claude to post or change something through it. **All** lets it use every tool. Either way, Claude runs with your user settings only for these connections: your hooks, skills and commands stay off, and every server you didn't choose is blocked. While it works, the steps say when it uses one ("Using Linear: get issue").

## Private notes

Notes are for you: reminders, questions to come back to, half-formed thoughts. **They're never posted to GitHub**, and they're kept in your local state file for this PR.

| Where | How |
|---|---|
| On a line | Select a line and press `m`. Or open the composer as for a comment and switch it to **Private note**; the choice sticks for the next one. |
| On a whole file | In the Diff view, click ✎ in the file's header. File notes show at the top of the file, and on its pages in every view. |
| On the whole PR | Press `M`, or click **Notes** (the pen) in the header, and write in the panel. |

A note on a line **floats beside it**, over the right edge of the code, like a sticky note; notes on nearby lines stack. Collapse one to a small icon on its line with – (or click its header), delete it with ✕. Notes follow the same file and PR collapsing as comments. The **Notes** panel (`M`) also lists every note on code; click one to jump to its page. The composer is dashed while it's in note mode.

## When the PR moves on

While a review is open, Bobby keeps it current, the way GitHub does:

- **New comments** on the PR appear on their lines by themselves (checked every minute), with a note saying who wrote them.
- **Since your last review.** Back on a PR you've reviewed, with commits since, the top bar offers **Since your review · N commits** (and the palette, **Review changes since your last review**): it opens a review of just what those commits changed, as GitHub's "changes since your last review" does. It's offered only while your review's commit is still in the PR's history; after a force-push that dropped it, there's no clean range to show.
- **New commits** on the PR, or a new base branch, aren't swapped in under you. A **New commits · Refresh** prompt appears in the top bar instead. Refresh rebuilds the review on them, on the same node. What the push didn't change keeps its marks; what it changed shows as unreviewed.
- **A local review** has no comments, but notices your new commits and edits (every 10 seconds) and offers **Files changed · Refresh** the same way. Switching branches can't be followed: run `bobby` again to review the other branch.

## Submitting

Press `s`. Add an optional summary, then choose **Comment**, **Approve** or **Request changes**. Only drafts are posted; private notes and review marks stay in Bobby (whole files viewed also tick GitHub's Viewed boxes). All drafts are posted together as one GitHub review on the PR's current head commit, and you get a link to it. Each draft leaves Bobby once it's on GitHub, so a submit that fails halfway can be tried again without posting anything twice.

- **A review you started on github.com.** GitHub allows one unsubmitted review per person. Its comments show on their lines in Bobby, tagged **pending** (only you see them). Submitting from Bobby adds your drafts to it and submits it, starting from its summary.
- **A draft on a line the diff doesn't show** (in a file the PR changes) posts as a comment on that whole file, starting with a link to its lines. GitHub comments on whole files show at the top of the file, under **On this file**. A draft in a file the PR doesn't change can't be a comment on GitHub, so it goes in the summary under "Notes on code this PR doesn't touch".

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

## Esc

`Esc` works on what's innermost, one layer per press:

1. a dialog, or the tour's callout;
2. an open comment or note box: it closes, and anything you wrote is kept as an **unfinished draft** on the same lines. It's listed with the page's comments (dashed), with **Continue** to pick it up again and ✕ to discard it. Unfinished drafts aren't counted in the drafts pill or posted with your review until you finish them;
3. a line selection: it clears;
4. focus mode (`f`): back to the view as it was;
5. details (`g`) or a page: back to where you were, and from there up a zoom level.
