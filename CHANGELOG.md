# Changelog

What changed in each release, newest first. Each release's full notes, with install commands, are on [GitHub releases](https://github.com/angrybayblade/bobby/releases).

## Unreleased

- **Submitting works with a review you started on github.com.** GitHub allows one unsubmitted review per person, so Bobby's submit used to fail when you had one. Its comments now show on their lines, tagged **pending**, and submitting from Bobby adds your drafts to it and submits it, starting from its summary.
- **Comments on whole files.** A draft on a line the diff doesn't show (in a file the PR changes) posts as a comment on that file, starting with a link to its lines, instead of going into the summary. GitHub's comments on whole files show at the top of their file.
- **Suggest a change.** On new lines, **± Suggest change** in the comment box puts the selected lines in a GitHub suggestion, to edit; GitHub offers the author a button to commit it. Suggestions show as the lines as they are and as suggested, inline and in the Conversation view.
- **Reactions.** React to comments, reviews and the description, or take your reaction back, as on GitHub.
- **Viewed files follow GitHub's Viewed boxes**, both ways: files ticked on GitHub open as viewed, and a file you finish (or unmark) in Bobby ticks (or clears) its box there.
- **Since your last review.** Back on a PR you've reviewed, with new commits, the top bar offers **Since your review · N commits**: a review of just what they changed.
- The home page labels approved PRs, and a long title no longer clips the tags after it.
- A file moved and largely rewritten shows as one moved file, not a deletion and an addition.
- **Claude answered** notices, in the bottom-right corner, when an answer arrives while it isn't on screen.
- In Outline, the wheel scrolls the page over a step's code too.
- **Clones go over HTTPS with gh's sign-in**, not through your SSH setup: several SSH identities or agents no longer get in the way. If HTTPS fails, Bobby asks before trying SSH (or `--ssh` allows it; **always** remembers it).
- **Your clone is found when its remote uses an SSH host alias** (`git@github-work:owner/repo`), as long as `~/.ssh/config` points the alias at github.com.
- **A log for bug reports.** Everything Bobby says, failed git and gh commands with their output, API errors and the page's errors go to `~/.bobby/logs/bobby.log` too, with times and levels and tokens blanked out; `bobby logs` shows its end and where it is.
- No focus outlines on buttons; the selection's buttons appear when you release the mouse, not while you drag.

## 0.1.0-rc13 (2026-10-25)

Claude as a reviewing partner: a review you steer, questions about any lines, references that open the code, and your own tools if you let it. `bobby update`, and Bun 1.4.4's security fixes.

- **Claude's review (preview).** **✦ Review with Claude** asks Claude Code to review the PR, about what you tell it to focus on (or anything): it reads the diff and checks the code around it (callers, definitions, tests) in a read-only copy of the head commit, and the pill shows it's at work, then how many findings it has. Go through its findings one at a time, worst first, each with the code it's about: **Add to review** (`a`) makes one your draft, as it is or edited first (`e`); **Dismiss** (`d`) drops it. They also sit on their lines in the diff as suggestions. Nothing is posted unless you add it and submit.
- **Ask Claude about code (preview).** Select some lines and press **✦** (or `q`): ask what they do, what could break, whether they're tested, or anything. Claude checks the code around them and answers on those lines as it writes; ask follow-ups, start a comment from the answer, or keep it as a private note.
- **Claude sees what you see.** Bobby gives Claude its own read-only tools: each file's diff, files before and after the PR, definitions and uses from the language servers, the review threads and git history. A review now reads the PR file by file and reports each finding once it's checked.
- **Claude cites code you can open.** Every reference in an answer, a finding or a summary is checked against the commit and becomes a link; a click opens that code in the viewer, the cited lines marked and the PR's changes highlighted, with **Show in diff**. Posted, they're GitHub links.
- **Claude can use your own tools.** Turn on your MCP servers and claude.ai connectors (Linear, Notion, Slack, Datadog…) for Claude, for every PR with `--agent-tools linear,notion` or for one PR in the Review with Claude dialog: each **Read** (only its tools that read) or **All**. Off unless you choose; your hooks, skills and commands stay off either way.
- **`bobby update`** installs the newest release in place of the one you ran (or `bobby update <version>`, to go back), checked against the release's `SHA256SUMS`. The new-version notice says so instead of giving the install script. From rc12 or earlier, update to this one with the install script once; `bobby update` works from here on.
- Three ways to look at a file in Diff, besides panning and zooming: **`d` fit** (the file you're on, as wide as it goes with its top at the top, as a double-click in the file tree; `d` again goes back), **`f` focus**, and **`g` details** (what was "full screen"). The inline / split switch moves from `d` to `l`.
- Delete a draft from **Submit review**: each draft in its list ends in a delete button, with Undo.
- `bobby <something that isn't a PR>` (a typo, or a command this version doesn't have) says so and stops, instead of starting Bobby and offering to set up GitHub's CLI.
- Built with Bun 1.4.4, for its security fixes: the bundled brotli decoder's out-of-bounds write (CVE-2026-111497), root certificates that still trusted compromised eMudhra intermediates, and HTTP/3 QPACK amplification. Running from source needs Bun 1.4.4 or later.

## 0.1.0-rc12 (2026-10-23)

Fixes to rc11's home page and setup dialogs.

- The home page scrolls as one page again, with its header and search held at the top while the lists scroll under them (rc11 had boxed the page into a window-high scroller).
- The setup dialogs' buttons and boxes are one height, and GitHub's code sits with its button; Claude's sign-in reads as one paragraph, then the link and the box for its code.

## 0.1.0-rc11 (2026-10-23)

GitHub's CLI set up from the page, as Claude Code is: Bobby on a fresh machine needs only itself and git.

- **Set up GitHub's CLI from Bobby.** The first time Bobby runs without `gh` (installed and signed in), the page offers to install it (from GitHub's releases, into `~/.local/bin`) and sign you in: copy the one-time code, enter it on github.com, and Bobby notices. `bobby <pr-url>` without it opens the page to set it up, then the PR. Works on a remote machine too.
- The install script installs the newest pre-release: it picked rc9 over rc10, in GitHub's order, instead of by version.
- The Claude Code setup on the home page has its own buttons' sizes: Cancel no longer stretches across the dialog, and its title isn't shrunk to a section heading.

## 0.1.0-rc10 (2026-10-23)

GitHub's thread workflow in Bobby, Claude Code set up from the page, and Bobby on a cloud VM.

- **Resolve conversation** and **Unresolve conversation** under each GitHub thread, in the code and in the Conversation view, as on GitHub: resolved, a thread collapses for everyone.
- Reply to a GitHub thread where it sits in the code, not only in the Conversation view: **Reply…** under it, posted at once.
- **3 unresolved** in the top bar counts GitHub's open threads; click it, or press `N`, to go through them. A **Resolved threads** setting hides resolved ones, to see only what's still open.
- **Edit** and **Delete** your own comments already on GitHub, in the code and in the Conversation view.
- Click a thread's or a note's header to collapse it.
- A comment edited on GitHub shows its new text without a reload.
- **Set up Claude Code from Bobby.** The first time Bobby runs without it, the page offers to install it (Anthropic's installer) and sign you in: open the sign-in link Bobby gets from `claude auth login`, sign in, and paste the code back. Works on a remote machine too. Reviews opened without it then ask Claude for their tree.
- Run Bobby on a cloud VM: `--host 0.0.0.0` to listen beyond this machine, and `--allow-host <name>` for the names its page may be opened at (`$BOBBY_HOST`, `$BOBBY_ALLOW_HOSTS`). `localhost` at any port works, so an SSH tunnel needs neither. Bobby warns when it's reachable from elsewhere.

## 0.1.0-rc9 (2026-10-23)

No change to Bobby itself; its site, bobby.viraj.computer, now works on phones.

- On a phone held upright, the walkthrough's mock is drawn twice as big and follows what each step is about; held sideways, the captions sit beside it. Touch screens get ↑ ↓ buttons in place of the `j` / `k` keys.

## 0.1.0-rc8 (2026-10-22)

A Conversation view of the PR, as on GitHub, and links that take you back to the same place.

- A **Conversation** view, first in the switcher: the PR's description, comments, reviews with their threads, and pushes in time order, then its reviewers, CI checks and whether it can merge, as on GitHub. Reply to a thread or comment on the PR from it. PRs only.
- Threads resolved on GitHub are tagged and start collapsed in every view; outdated threads, whose line the diff no longer has, are counted above their file's code and open in the Conversation view.
- The address bar follows you: `…/diff/<file>#L42`, `…/flow/<file>#L42`, `…/conversation`. Reload, bookmark or share a link to land on the same view and step; back and forward move between views.
- **⚙ Generated** gets its own switch, apart from **⚗ Tests**.
- Code cut from the middle of a block comment is highlighted as comment, not as code.
- Home page rows link to their review, so ⌘-click opens it in a new tab, even a PR you haven't opened yet. Right-click a row (or ⇧F10) to open it, open it in a new tab, open it on GitHub (`o`), or copy its link.
- `bobby` in a repo with nothing to review (on main, say) opens the home page instead of exiting.
- Spacing fixes: Lens's edge labels wrap inside the gap between cards instead of running over them, and its edges draw again; the uses window's filters, the submit dialog's drafts (one line each, with an ellipsis), the welcome-back choices and a note's header no longer crowd or break; a Conversation thread's line numbers stay in their column.

## 0.1.0-rc7 (2026-10-16)

A home page to pick PRs from, and one Bobby for all your reviews.

- A home page: paste a PR, or pick one from Recents (with your progress), Review requested, My PRs and All, filtered by repo, author and title. `bobby` outside a repo, or `bobby home`, opens it.
- One Bobby holds every review you open, each at its own address; `bobby <PR>` while one is running opens it there. Reviews no page has looked at for 15 minutes are closed to free memory.
- Review one commit of a PR, or a range of commits: `bobby <pr-url>/changes/<sha>` (or `<from>..<to>`), as GitHub's commit view.
- A third style, **Silverpoint**: graphite and silver neutrals on a toned ground, one muted steel accent, in dark and light (Settings › Style).
- A new logo: Bobby, the curious puppy.
- The loading screen matches the app; focus rings are a quieter steel blue; double-click a file in the tree to zoom right into it.
- Upgrading from an rc: the home page's Recents starts with the PRs you'd already reviewed (from their saved progress), and a Bobby from an earlier rc still running on a review is detected rather than overwritten.

## 0.1.0-rc6 (2026-10-15)

- Bobby says when a newer version is out (at start and every 6 hours), with the command to update. Off in Settings or with `BOBBY_NO_UPDATE_CHECK=1`.
- The Diff view skips drawing off-screen files' code: smoother panning on large PRs.

## 0.1.0-rc5 (2026-10-15)

Bobby is now MIT-licensed. Comments show in place, as GitHub threads; an open review keeps up with the PR; and a long list of fixes from an audit before the stable release.

**Keeping current**
- New comments on the PR appear on their lines while you review.
- New commits on the PR, or new work on a local branch, are offered with a **Refresh** prompt, never swapped in; refreshing keeps your place and your marks on what didn't change.

**Comments in place**
- Threads sit under their line, like GitHub's, with avatars, Markdown and **Show more**; in a split diff, on the side they were made on. Private notes float beside their line.
- Collapse a thread, a file's comments or the whole PR's; markers say how many are above or below.
- The comment box opens where the comment will sit, with a Comment / Private note switch. **Cancel** discards; `esc` keeps it as an unfinished draft.
- A first review opens in the Diff view.

**Flow**
- The arrow keys move at every level; ← always retracts, to the parent and then out a level.

**Keyboard**
- `]` / `[` select the next or previous line and `}` / `{` grow the selection, so `c` and `m` can comment on a line you chose.
- Enter and space work on a button you've tabbed to; Tab stays inside an open dialog, and closing it gives focus back.
- A file's viewed box in the file tree can be reached by keyboard, and focus stays put when the chrome redraws.
- Diff's ← / → history survives a reload.
- Every hint and tooltip shows your own keys.

**Review**
- Undo after deleting a draft or a note.
- Binary files, pure renames, mode changes and empty files appear on the Low-signal page; a renamed file's header shows where it came from.
- GitHub comments on the old side of an unchanged line show, and count in "comments below".
- "More below" only where the file has more; the Low-signal page says when it cuts a long hunk short.
- `bobby clean [--repos]`, and a daily tidy of caches older than a month and old language-server versions.

**Reliability**
- Bobby's server only answers its own page: another website can no longer read your review or post as you.
- Your progress is written atomically, and a state file that can't be read is kept aside instead of being overwritten.
- A second `bobby` on the same review opens the one already running instead of saving over it.
- A draft whose line has left the diff goes into the review's summary instead of making GitHub refuse the whole review.
- Comment text survives re-renders and moving away; a failed save keeps the box open with its text, and says so.
- A failed load, save or status check says what happened instead of failing silently.
- Enter and space work on a button you've tabbed to; enter on **Approve** posts the review instead of closing the dialog, and it can't be posted twice.
- A local review keeps uncommitted changes when `git stash create` refuses (intent-to-add files, a merge in progress).
- A fresh machine with Go installed no longer crashes on start.
- highlight.js ships with Bobby instead of loading from a CDN.
- A retargeted PR is rebuilt (the cache key includes the base branch); a cached PR fetches its commits if the clone lacks them.
- `--no-llm` shows no Claude tree, even a cached one; `--refresh` asks the language servers afresh.
- A language server that keeps timing out is dropped for imports instead of leaving names loading for hours; Check again answers at once.
- Claude gives up after 15 minutes; a review GitHub took is counted as posted even if its reply was lost.
- File names git quotes (or ends with a tab) are read right; GitHub Enterprise URLs and a missing `gh` say so instead of crashing; CLI failures are one line.
- Windows: line endings no longer read as changes in a local review, and monorepo workspaces link without Developer Mode.
- The inspector's window no longer gets stuck after a focus change, and the focus nudges keep working after switching trees.

**Faster**
- Toggling Tests or Untouched builds the views once (about twice as fast); switching views renders once; resizes are handled once a frame.
- Word marks can't freeze the page on big reformatted hunks; Flow no longer leaks a canvas per visit.
- The status poll redraws only when something changed. Finding uses without a language server is remembered and doesn't stall the server.
- Reading a language server's large answers, resolving Go, Java and Python imports, and caches of files read are all bounded or indexed.

**For tools reading the graph**
- `generator.version` is Bobby's version; the extraction's own is `generator.extraction`.
- The schema describes `definitions` and comment ranges (`startLine`, `startSide`); names with no text are no longer emitted.

**Project**
- MIT license, with notices for what the binaries carry (Bun, tree-sitter, highlight.js).
- Tests (diff parsing, key bindings, an extracted graph validated against the schema) and CI on every push, with a binary smoke test on macOS, Linux and Windows.
- [What leaves your machine](docs/privacy.md): what Bobby sends to Claude, GitHub and others.

## 0.1.0-rc4 (2026-10-14)

Inspect a name (⌘-click) and list where it's used (⌘⇧-click), with language servers for TypeScript, JavaScript, Python and Go; rebindable keys; back and forth through files in the Diff view.

## 0.1.0-rc3 (2026-10-13)

Dependencies are traced through the syntax tree and imports instead of text search: fewer, right links, and minutes faster on a large repo. Comments on a range of lines, a command palette, a first-run tour, and a Diff canvas that zooms like a map.

## 0.1.0-rc2 (2026-10-12)

Every view shares the Diff view's look, keys and file viewer. Flow is rebuilt as one tree that starts from the changes. Tests, generated files and untouched code are hidden by default.

## 0.1.0-rc1 (2026-10-11)

A GitHub-style Diff view with split diffs and a focus mode, and a one-command install.

## 0.1.0-rc0 (2026-10-10)

The first release candidate.
